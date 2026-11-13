package com.lwoptimizer.ui.usecase;

import com.lwoptimizer.constraint.ConstraintProvider;
import com.lwoptimizer.solver.OptimizerConfig;
import com.lwoptimizer.ui.api.dto.FieldDto;

import java.util.List;

/**
 * What the API and the interface need to know about one optimization use case: its model,
 * constraints and configuration file, and how to go back and forth between the planning
 * solution and the plan exchanged over HTTP.
 *
 * <p>The plan type {@code P} serves both ways. In a request it carries the problem data and,
 * optionally, an assignment and pins to start from; in a response it also carries figures
 * derived from the assignment (loads, distances, times), which are ignored when sent back.
 *
 * @param <S> the planning solution type of the optimizer
 * @param <P> the plan exchanged with clients
 */
public interface UseCase<S, P> {

    Class<S> solutionType();

    ConstraintProvider<S> constraints();

    /** The configuration file shipped with the use case; its values are the defaults. */
    String configFile();

    /** The ready-made problem, without any assignment. */
    S demo(OptimizerConfig config);

    /**
     * Builds the planning solution from a plan received from a client, assignment and pins
     * included.
     *
     * @throws IllegalArgumentException if the plan is inconsistent (unknown name, missing data)
     */
    S fromPlan(P plan, OptimizerConfig config);

    P toPlan(S solution);

    /** Settings of the problem itself (the {@code problem} section), beyond those of the solver. */
    default List<FieldDto> problemFields() {
        return List.of();
    }

    /** Rejects settings of the {@code problem} section that this use case does not know. */
    default void checkProblemSettings(OptimizerConfig config) {
        config.problem().requireNoUnknownKeys();
    }
}
