package com.lwoptimizer.ui.usecase;

import com.lwoptimizer.constraint.ConstraintProvider;
import com.lwoptimizer.solver.OptimizerConfig;
import com.lwoptimizer.usecase.taskassignment.TaskAssignmentConstraints;
import com.lwoptimizer.usecase.taskassignment.TaskAssignmentData;
import com.lwoptimizer.usecase.taskassignment.domain.Employee;
import com.lwoptimizer.usecase.taskassignment.domain.Task;
import com.lwoptimizer.usecase.taskassignment.domain.TaskPlan;
import com.lwoptimizer.usecase.taskassignment.domain.Workload;
import io.swagger.v3.oas.annotations.media.Schema;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Component
public final class TaskAssignmentUseCase implements UseCase<TaskPlan, TaskAssignmentUseCase.Plan> {

    @Schema(name = "TaskAssignmentPlan", description = "Employees, tasks and who does what")
    public record Plan(
            List<EmployeeDto> employees,
            List<TaskDto> tasks,
            @Schema(description = "Total labour cost of the assignment", accessMode = Schema.AccessMode.READ_ONLY)
            Long cost) {
    }

    @Schema(name = "Employee")
    public record EmployeeDto(
            @Schema(example = "Ann") String name,
            @Schema(example = "[\"java\", \"sql\"]") List<String> skills,
            @Schema(description = "Hours available", example = "32") int capacityHours,
            @Schema(example = "55") int hourlyCost,
            @Schema(description = "Hours assigned", accessMode = Schema.AccessMode.READ_ONLY) Integer load) {
    }

    @Schema(name = "Task")
    public record TaskDto(
            @Schema(example = "T01-java") String name,
            @Schema(example = "java") String requiredSkill,
            @Schema(example = "7") int hours,
            @Schema(description = "Name of the employee who does the task; absent when not assigned", example = "Ann")
            String employee,
            @Schema(description = "True to keep this assignment as it is when optimizing again") boolean pinned,
            @Schema(description = "True when the employee lacks the required skill",
                    accessMode = Schema.AccessMode.READ_ONLY) Boolean lacksSkill) {
    }

    @Override
    public Class<TaskPlan> solutionType() {
        return TaskPlan.class;
    }

    @Override
    public ConstraintProvider<TaskPlan> constraints() {
        return new TaskAssignmentConstraints();
    }

    @Override
    public String configFile() {
        return "task-assignment.yaml";
    }

    @Override
    public TaskPlan demo(OptimizerConfig config) {
        return TaskAssignmentData.demo();
    }

    @Override
    public TaskPlan fromPlan(Plan plan, OptimizerConfig config) {
        if (plan.employees() == null || plan.tasks() == null) {
            throw new IllegalArgumentException("A task assignment plan needs employees and tasks");
        }
        Map<String, Employee> employees = new LinkedHashMap<>();
        for (EmployeeDto employee : plan.employees()) {
            employees.put(employee.name(), new Employee(employee.name(),
                    employee.skills() == null ? Set.of() : Set.copyOf(employee.skills()),
                    employee.capacityHours(), employee.hourlyCost()));
        }
        List<Task> tasks = new ArrayList<>();
        for (TaskDto dto : plan.tasks()) {
            Task task = new Task(dto.name(), dto.requiredSkill(), dto.hours());
            if (dto.employee() != null && !dto.employee().isBlank()) {
                Employee employee = employees.get(dto.employee());
                if (employee == null) {
                    throw new IllegalArgumentException("Task " + dto.name() + " is assigned to '" + dto.employee()
                            + "', who is not among the employees");
                }
                task.setEmployee(employee);
            }
            if (dto.pinned() && task.employee() == null) {
                throw new IllegalArgumentException("Task " + dto.name() + " is pinned but has no employee");
            }
            task.setPinned(dto.pinned());
            tasks.add(task);
        }
        return new TaskPlan(new ArrayList<>(employees.values()), tasks);
    }

    @Override
    public Plan toPlan(TaskPlan plan) {
        List<EmployeeDto> employees = new ArrayList<>();
        for (Workload workload : plan.workloads()) {
            Employee employee = workload.employee();
            employees.add(new EmployeeDto(employee.name(), employee.skills().stream().sorted().toList(),
                    employee.capacityHours(), employee.hourlyCost(), workload.hours()));
        }
        List<TaskDto> tasks = plan.tasks().stream()
                .map(task -> new TaskDto(task.name(), task.requiredSkill(), task.hours(),
                        task.employee() == null ? null : task.employee().name(), task.isPinned(), task.lacksSkill()))
                .toList();
        return new Plan(employees, tasks, plan.tasks().stream().mapToLong(Task::cost).sum());
    }
}
