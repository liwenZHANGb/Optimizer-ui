package com.lwoptimizer.ui.service;

import com.lwoptimizer.constraint.ConstraintConfig;
import com.lwoptimizer.constraint.score.ConstraintMatchTotal;
import com.lwoptimizer.constraint.score.ConstraintScoreCalculator;
import com.lwoptimizer.constraint.score.Score;
import com.lwoptimizer.constraint.score.ScoreAnalysis;
import com.lwoptimizer.model.PlanningModel;
import com.lwoptimizer.solver.OptimizerConfig;
import com.lwoptimizer.solver.Solver;
import com.lwoptimizer.solver.SolverResult;
import com.lwoptimizer.ui.api.dto.ConstraintLine;
import com.lwoptimizer.ui.api.dto.ScoreDto;
import com.lwoptimizer.ui.api.dto.Snapshot;
import com.lwoptimizer.ui.api.dto.SolveRequest;
import com.lwoptimizer.ui.usecase.UseCase;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.UUID;

/** Starts optimizations in the background and keeps the most recent jobs. */
@Service
public class JobService {

    private static final int KEPT_JOBS = 30;

    private final ConfigurationService configurations;
    private final Map<String, Job<?>> jobs = new LinkedHashMap<>() {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Job<?>> eldest) {
            return size() > KEPT_JOBS && !eldest.getValue().isRunning();
        }
    };

    public JobService(ConfigurationService configurations) {
        this.configurations = configurations;
    }

    /**
     * Starts solving the plan of the request, or the ready-made problem when it has none.
     *
     * @throws IllegalArgumentException if the settings or the plan are invalid
     * @throws IllegalStateException    if the problem cannot be prepared (service unreachable...)
     */
    public <S, P> Job<P> start(UseCase<S, P> useCase, SolveRequest<P> request) {
        OptimizerConfig config = configurations.assemble(useCase, request);
        S problem = problem(useCase, request, config);
        PlanningModel<S> model = PlanningModel.fromAnnotations(useCase.solutionType(), config.model());
        if (config.model().validateOnSolve()) {
            model.validate(problem);
        }
        ConstraintScoreCalculator<S> calculator =
                ConstraintScoreCalculator.of(model, useCase.constraints(), config.constraints());

        String engine = config.settings().getOrDefault("solver.engine", "jenetics");
        Job<P> job = new Job<>(UUID.randomUUID().toString(), engine);
        long start = System.currentTimeMillis();
        Solver<S> solver = Solver.builder(model)
                .scoreCalculator(calculator)
                .config(config.solver())
                .bestSolutionListener((progress, solution) -> {
                    // The solution is a snapshot of its own: it can be turned into a plan right here.
                    P plan = useCase.toPlan(solution);
                    ScoreAnalysis analysis = calculator.analyze(solution);
                    job.offer(index -> new Snapshot<>(index, progress.step(), progress.elapsed().toMillis(),
                            ScoreDto.of(analysis.score()), plan, lines(analysis)));
                })
                .build();
        job.onStop(solver::terminateEarly);

        // Snapshot 0 is the plan as submitted, so that the interface shows where the search starts from.
        ScoreAnalysis initial = calculator.analyze(problem);
        P submitted = useCase.toPlan(problem);
        job.offer(index -> new Snapshot<>(index, 0, 0, ScoreDto.of(initial.score()), submitted, lines(initial)));

        synchronized (jobs) {
            jobs.put(job.id(), job);
        }
        Thread.ofPlatform().name("solve-" + job.id()).daemon(true).start(() -> {
            try {
                SolverResult<S> result = solver.solve(problem);
                P plan = useCase.toPlan(result.bestSolution());
                job.complete(index -> new Snapshot<>(index, result.steps(), System.currentTimeMillis() - start,
                        ScoreDto.of(result.score()), plan, lines(result.analysis())), result.terminationReason().name());
            } catch (RuntimeException e) {
                job.fail(e.getMessage() == null ? e.toString() : e.getMessage());
            }
        });
        return job;
    }

    /** Scores a plan as it is, without solving. */
    public <S, P> Snapshot<P> analyze(UseCase<S, P> useCase, SolveRequest<P> request) {
        OptimizerConfig config = configurations.assemble(useCase, request);
        S problem = problem(useCase, request, config);
        PlanningModel<S> model = PlanningModel.fromAnnotations(useCase.solutionType(), config.model());
        ScoreAnalysis analysis = ConstraintScoreCalculator.of(model, useCase.constraints(), config.constraints())
                .analyze(problem);
        return new Snapshot<>(0, 0, 0, ScoreDto.of(analysis.score()), useCase.toPlan(problem), lines(analysis));
    }

    @SuppressWarnings("unchecked")
    public <P> Job<P> find(String id) {
        synchronized (jobs) {
            Job<?> job = jobs.get(id);
            if (job == null) {
                throw new NoSuchElementException("No job " + id);
            }
            return (Job<P>) job;
        }
    }

    private static <S, P> S problem(UseCase<S, P> useCase, SolveRequest<P> request, OptimizerConfig config) {
        return request == null || request.plan() == null
                ? useCase.demo(config)
                : useCase.fromPlan(request.plan(), config);
    }

    private static List<ConstraintLine> lines(ScoreAnalysis analysis) {
        List<ConstraintLine> lines = new ArrayList<>();
        for (ConstraintMatchTotal total : analysis.constraints()) {
            Score weight = total.weight();
            Score score = total.score();
            String level = weight.hard() > 0 ? "hard" : weight.medium() > 0 ? "medium" : "soft";
            long points = weight.hard() > 0 ? score.hard() : weight.medium() > 0 ? score.medium() : score.soft();
            long amount = weight.hard() > 0 ? weight.hard() : weight.medium() > 0 ? weight.medium() : weight.soft();
            lines.add(new ConstraintLine(total.constraintName(), ConstraintConfig.key(total.constraintName()), level,
                    amount + level, total.matchCount(), points, score.toString()));
        }
        return lines;
    }
}
