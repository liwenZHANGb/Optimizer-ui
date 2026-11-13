package com.lwoptimizer.ui.service;

import com.lwoptimizer.constraint.Constraint;
import com.lwoptimizer.constraint.ConstraintConfig;
import com.lwoptimizer.constraint.score.ConstraintScoreCalculator;
import com.lwoptimizer.constraint.score.Score;
import com.lwoptimizer.model.PlanningModel;
import com.lwoptimizer.solver.OptimizerConfig;
import com.lwoptimizer.solver.SolverConfig;
import com.lwoptimizer.solver.TerminationConfig;
import com.lwoptimizer.solver.jenetics.JeneticsConfig;
import com.lwoptimizer.solver.ortools.OrToolsConfig;
import com.lwoptimizer.ui.api.dto.ConfigurationDto;
import com.lwoptimizer.ui.api.dto.ConstraintSetting;
import com.lwoptimizer.ui.api.dto.FieldDto;
import com.lwoptimizer.ui.api.dto.FieldDto.Option;
import com.lwoptimizer.ui.api.dto.SolveRequest;
import com.lwoptimizer.ui.usecase.UseCase;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * Describes what can be tuned for a use case, with defaults taken from its configuration
 * file, and turns the settings of a request back into an {@link OptimizerConfig}. All the
 * validation is the optimizer's own: an invalid value comes back with its message.
 */
@Service
public class ConfigurationService {

    private static final String SEARCH = "Search";
    private static final String GENETIC = "Genetic algorithm";
    private static final String ENGINE = "solver.engine";

    public ConfigurationDto describe(UseCase<?, ?> useCase) {
        OptimizerConfig file = OptimizerConfig.load(useCase.configFile());
        Map<String, String> settings = file.settings();

        List<Option> engines = new ArrayList<>();
        engines.add(new Option("jenetics", "Genetic algorithm (Jenetics)"));
        if (settings.containsKey("solver.ortools.formulation")) {
            engines.add(new Option("ortools", "OR-Tools"));
        }
        if (settings.containsKey("solver.choco.formulation")) {
            engines.add(new Option("choco", "Choco"));
        }

        List<FieldDto> fields = new ArrayList<>(useCase.problemFields());
        fields.addAll(List.of(
                FieldDto.select(ENGINE, "Engine", SEARCH, engines,
                        "The genetic algorithm works from the constraints alone. The other engines solve a "
                                + "mathematical formulation of the same problem."),
                FieldDto.number("solver.termination.timeLimit", "Time limit", SEARCH, 1, 600, 1, "s", true,
                        "The search stops after this long at the latest."),
                FieldDto.number("solver.termination.unimprovedStepLimit", "Stop when stalled after", SEARCH, 1,
                        1_000_000, 100, "steps", false,
                        "Stop once this many steps in a row bring no improvement. Empty: only the time limit applies."),
                FieldDto.number("solver.randomSeed", "Random seed", SEARCH, 0, 1_000_000, 1, null, false,
                        "The same seed gives the same search. Empty: a different search every run."),
                FieldDto.toggle("solver.warmStart", "Start from the current plan", SEARCH,
                        "When the plan already has an assignment, improve it rather than starting from scratch."),
                jenetics(FieldDto.number("solver.jenetics.populationSize", "Population", GENETIC, 2, 5000, 10, null,
                        true, "Candidate plans kept at each generation.")),
                jenetics(FieldDto.number("solver.jenetics.offspringFraction", "Offspring fraction", GENETIC, 0.05, 1,
                        0.05, null, true, "Share of each generation that is newly produced.")),
                jenetics(FieldDto.number("solver.jenetics.eliteCount", "Elite", GENETIC, 0, 100, 1, null, true,
                        "Best candidates that always survive unchanged.")),
                jenetics(FieldDto.number("solver.jenetics.tournamentSize", "Tournament size", GENETIC, 2, 10, 1, null,
                        true, "Higher means stronger selection, faster convergence, less diversity.")),
                jenetics(FieldDto.select("solver.jenetics.crossover", "Crossover", GENETIC, List.of(
                        new Option("UNIFORM", "Uniform"), new Option("SINGLE_POINT", "Single point"),
                        new Option("TWO_POINT", "Two points")), "How two parents are mixed.")),
                jenetics(FieldDto.number("solver.jenetics.crossoverProbability", "Crossover probability", GENETIC, 0, 1,
                        0.01, null, true, "Chance that a selected candidate takes part in a crossover.")),
                jenetics(FieldDto.number("solver.jenetics.mutationProbability", "Mutation probability", GENETIC, 0, 1,
                        0.01, null, true, "Chance of redrawing a decision at random.")),
                jenetics(FieldDto.number("solver.jenetics.swapMutationProbability", "Swap probability", GENETIC, 0, 1,
                        0.01, null, true, "Chance of exchanging two decisions.")),
                jenetics(FieldDto.number("solver.jenetics.gaussianMutationProbability", "Nudge probability", GENETIC, 0,
                        1, 0.01, null, true, "Chance of moving a decision to a neighbouring value or position.")),
                FieldDto.number("solver.ortools.workers", "Parallel workers", "OR-Tools", 1, 64, 1, null, true,
                        "Search threads of CP-SAT.").when(ENGINE, "ortools")));
        if (engines.stream().noneMatch(engine -> engine.value().equals("ortools"))) {
            fields.removeIf(field -> field.key().startsWith("solver.ortools."));
        }

        return new ConfigurationDto(fields, defaults(file, fields), constraints(useCase, file));
    }

    /**
     * The configuration of a run: the file of the use case, overridden by the settings and
     * the constraints of the request.
     *
     * @throws IllegalArgumentException with the optimizer's message when a value is invalid
     */
    public OptimizerConfig assemble(UseCase<?, ?> useCase, SolveRequest<?> request) {
        Map<String, String> settings = new TreeMap<>(OptimizerConfig.load(useCase.configFile()).settings());
        if (request != null && request.settings() != null) {
            request.settings().forEach((key, value) -> {
                if (value == null || value.isBlank()) {
                    settings.remove(key);
                } else {
                    settings.put(key, key.endsWith("imeLimit") && value.matches("[0-9.]+") ? value + "s" : value);
                }
            });
        }
        if (request != null && request.constraints() != null) {
            for (ConstraintSetting constraint : request.constraints()) {
                String prefix = "constraints." + ConstraintConfig.key(constraint.key()) + ".";
                if (constraint.enabled() != null) {
                    settings.put(prefix + "enabled", constraint.enabled().toString());
                }
                if (constraint.weight() != null && constraint.level() != null) {
                    settings.put(prefix + "weight", constraint.weight() + constraint.level().toLowerCase());
                }
            }
        }
        OptimizerConfig config = OptimizerConfig.of(settings);
        useCase.checkProblemSettings(config);
        return config;
    }

    private static FieldDto jenetics(FieldDto field) {
        return field.when(ENGINE, "jenetics");
    }

    /** The value each field has when the request says nothing: the file's, else the optimizer's default. */
    private static Map<String, String> defaults(OptimizerConfig file, List<FieldDto> fields) {
        SolverConfig solver = file.solver();
        TerminationConfig termination = solver.termination();
        JeneticsConfig jenetics = (JeneticsConfig) file.solver("jenetics").engine();

        Map<String, String> known = new LinkedHashMap<>();
        known.put(ENGINE, file.settings().getOrDefault(ENGINE, "jenetics"));
        known.put("solver.termination.timeLimit",
                termination.timeLimit() == null ? "" : number(termination.timeLimit().toMillis() / 1000.0));
        known.put("solver.termination.unimprovedStepLimit", text(termination.unimprovedStepLimit()));
        known.put("solver.randomSeed", text(solver.randomSeed()));
        known.put("solver.warmStart", String.valueOf(solver.warmStart()));
        known.put("solver.jenetics.populationSize", String.valueOf(jenetics.populationSize()));
        known.put("solver.jenetics.offspringFraction", number(jenetics.offspringFraction()));
        known.put("solver.jenetics.eliteCount", String.valueOf(jenetics.eliteCount()));
        known.put("solver.jenetics.tournamentSize", String.valueOf(jenetics.tournamentSize()));
        known.put("solver.jenetics.crossover", jenetics.crossover().name());
        known.put("solver.jenetics.crossoverProbability", number(jenetics.crossoverProbability()));
        known.put("solver.jenetics.mutationProbability", number(jenetics.mutationProbability()));
        known.put("solver.jenetics.swapMutationProbability", number(jenetics.swapMutationProbability()));
        known.put("solver.jenetics.gaussianMutationProbability", number(jenetics.gaussianMutationProbability()));
        if (file.settings().containsKey("solver.ortools.formulation")) {
            known.put("solver.ortools.workers",
                    String.valueOf(((OrToolsConfig) file.solver("ortools").engine()).workers()));
        }

        Map<String, String> defaults = new LinkedHashMap<>();
        for (FieldDto field : fields) {
            // Settings of the problem are all written in the file of the use case.
            defaults.put(field.key(), known.getOrDefault(field.key(), file.settings().getOrDefault(field.key(), "")));
        }
        return defaults;
    }

    private static <S> List<ConstraintSetting> constraints(UseCase<S, ?> useCase, OptimizerConfig file) {
        PlanningModel<S> model = PlanningModel.fromAnnotations(useCase.solutionType(), file.model());
        List<ConstraintSetting> constraints = new ArrayList<>();
        for (Constraint<S> constraint : ConstraintScoreCalculator.of(model, useCase.constraints()).constraints()) {
            Score weight = file.constraints().effectiveWeight(constraint);
            String level = weight.hard() > 0 ? "hard" : weight.medium() > 0 ? "medium" : "soft";
            long amount = weight.hard() > 0 ? weight.hard() : weight.medium() > 0 ? weight.medium() : weight.soft();
            constraints.add(new ConstraintSetting(ConstraintConfig.key(constraint.name()), constraint.name(),
                    file.constraints().isEnabled(constraint.name()), level, amount, constraint.impact().name()));
        }
        return constraints;
    }

    private static String text(Long value) {
        return value == null ? "" : value.toString();
    }

    private static String number(double value) {
        return value == Math.rint(value) ? String.valueOf((long) value) : String.valueOf(value);
    }
}
