package com.lwoptimizer.ui.api;

import com.lwoptimizer.ui.service.ConfigurationService;
import com.lwoptimizer.ui.service.JobService;
import com.lwoptimizer.ui.usecase.VrpUseCase;
import com.lwoptimizer.usecase.cvrp.domain.Location;
import com.lwoptimizer.usecase.cvrp.domain.RoutingPlan;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.NoSuchElementException;

@RestController
@RequestMapping("/api/vrp")
@Tag(name = "Vehicle routing",
        description = "Route a fleet from one depot: every customer served if capacity allows, no vehicle "
                + "overloaded, as little driving as possible. Addresses are geocoded with OpenStreetMap "
                + "(Nominatim); travel times come from the road network (OSRM), from straight lines or from "
                + "random bounds, as chosen with the setting problem.travel.source. The start of a route, or a "
                + "whole route, can be pinned for rescheduling.")
public class VrpApi extends UseCaseApi<RoutingPlan, VrpUseCase.Plan> {

    @Schema(name = "Coordinates")
    public record Coordinates(String address, double latitude, double longitude) {
    }

    private final VrpUseCase vrp;

    public VrpApi(VrpUseCase useCase, JobService jobs, ConfigurationService configurations) {
        super(useCase, jobs, configurations);
        this.vrp = useCase;
    }

    @GetMapping("/geocode")
    @Operation(summary = "Find the coordinates of an address",
            description = "Uses the Nominatim geocoder of OpenStreetMap. The public service accepts one request "
                    + "per second: calls are spaced accordingly.")
    public Coordinates geocode(
            @Parameter(description = "Postal address", example = "Place Bellecour, Lyon, France")
            @RequestParam String address) {
        Location location = vrp.geocode(address, configurations.assemble(vrp, null))
                .orElseThrow(() -> new NoSuchElementException("Address not found: " + address));
        return new Coordinates(address, location.latitude(), location.longitude());
    }
}
