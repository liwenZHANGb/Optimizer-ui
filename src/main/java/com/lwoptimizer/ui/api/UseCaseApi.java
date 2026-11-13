package com.lwoptimizer.ui.api;

import com.lwoptimizer.ui.api.dto.ConfigurationDto;
import com.lwoptimizer.ui.api.dto.JobDto;
import com.lwoptimizer.ui.api.dto.JobRef;
import com.lwoptimizer.ui.api.dto.Snapshot;
import com.lwoptimizer.ui.api.dto.SolveRequest;
import com.lwoptimizer.ui.service.ConfigurationService;
import com.lwoptimizer.ui.service.Job;
import com.lwoptimizer.ui.service.JobService;
import com.lwoptimizer.ui.usecase.UseCase;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.List;

/**
 * The operations every use case offers. Each use case has its own controller, which only
 * adds its path and its plan type, so that its API is documented with its own data model.
 *
 * @param <S> the planning solution type of the optimizer
 * @param <P> the plan exchanged with clients
 */
public abstract class UseCaseApi<S, P> {

    protected final UseCase<S, P> useCase;
    protected final JobService jobs;
    protected final ConfigurationService configurations;

    protected UseCaseApi(UseCase<S, P> useCase, JobService jobs, ConfigurationService configurations) {
        this.useCase = useCase;
        this.jobs = jobs;
        this.configurations = configurations;
    }

    @GetMapping("/problem")
    @Operation(summary = "The ready-made problem",
            description = "A complete problem without any assignment. Send it back, as it is or edited, to POST /jobs.")
    public P problem() {
        return useCase.toPlan(useCase.demo(configurations.assemble(useCase, null)));
    }

    @GetMapping("/configuration")
    @Operation(summary = "What can be tuned, with defaults",
            description = "The solver and algorithm settings with their allowed values and defaults, and the "
                    + "constraints with their default nature (hard, medium, soft), weight and state.")
    public ConfigurationDto configuration() {
        return configurations.describe(useCase);
    }

    @PostMapping("/jobs")
    @ResponseStatus(HttpStatus.ACCEPTED)
    @Operation(summary = "Start an optimization",
            description = "Returns at once with the id of the job. When the plan of the request already carries "
                    + "an assignment, the search starts from it, and what is pinned in it does not change.")
    public JobRef solve(@RequestBody(required = false) SolveRequest<P> request) {
        return new JobRef(jobs.start(useCase, request).id());
    }

    @PostMapping("/analysis")
    @Operation(summary = "Score a plan without solving it",
            description = "Returns the plan with its derived figures, its score and the contribution of each "
                    + "constraint. Useful after editing a plan by hand.")
    public Snapshot<P> analyze(@RequestBody(required = false) SolveRequest<P> request) {
        return jobs.analyze(useCase, request);
    }

    @GetMapping("/jobs/{id}")
    @Operation(summary = "State of a job and its best plan so far")
    public JobDto<P> job(@PathVariable String id) {
        return jobs.<P>find(id).describe();
    }

    @DeleteMapping("/jobs/{id}")
    @Operation(summary = "Stop a job early", description = "The job ends with the best plan found so far.")
    public JobDto<P> stop(@PathVariable String id) {
        Job<P> job = jobs.find(id);
        job.stop();
        return job.describe();
    }

    @GetMapping(value = "/jobs/{id}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    @Operation(summary = "Follow a job live",
            description = "A server-sent event stream. Each `snapshot` event is a better plan with its score, "
                    + "starting with the submitted plan; the stream ends with a `done` or `failed` event "
                    + "carrying the job.")
    public SseEmitter events(@PathVariable String id,
                             @Parameter(description = "Index of the first snapshot to send") Integer from) {
        Job<P> job = jobs.find(id);
        SseEmitter emitter = new SseEmitter(0L);
        Thread.ofVirtual().name("events-" + id).start(() -> {
            int next = from == null ? 0 : from;
            try {
                while (true) {
                    List<Snapshot<P>> fresh = job.snapshotsFrom(next, 150);
                    for (Snapshot<P> snapshot : fresh) {
                        emitter.send(SseEmitter.event().name("snapshot").data(snapshot, MediaType.APPLICATION_JSON));
                    }
                    next += fresh.size();
                    if (fresh.isEmpty() && !job.isRunning()) {
                        JobDto<P> end = job.describe();
                        emitter.send(SseEmitter.event().name(end.error() == null ? "done" : "failed")
                                .data(end, MediaType.APPLICATION_JSON));
                        emitter.complete();
                        return;
                    }
                }
            } catch (IOException | IllegalStateException e) {
                emitter.completeWithError(e);   // the client went away
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                emitter.complete();
            }
        });
        return emitter;
    }
}
