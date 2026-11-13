package com.lwoptimizer.ui.api;

import com.lwoptimizer.ui.service.ConfigurationService;
import com.lwoptimizer.ui.service.JobService;
import com.lwoptimizer.ui.usecase.TaskAssignmentUseCase;
import com.lwoptimizer.usecase.taskassignment.domain.TaskPlan;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/task-assignment")
@Tag(name = "Task assignment",
        description = "Give every task to an employee who has the skill, within their hours, at the lowest cost "
                + "and with an even workload. Tasks can be pinned to their employee for rescheduling.")
public class TaskAssignmentApi extends UseCaseApi<TaskPlan, TaskAssignmentUseCase.Plan> {

    public TaskAssignmentApi(TaskAssignmentUseCase useCase, JobService jobs, ConfigurationService configurations) {
        super(useCase, jobs, configurations);
    }
}
