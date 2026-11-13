package com.lwoptimizer.ui.usecase;

import com.lwoptimizer.constraint.ConstraintProvider;
import com.lwoptimizer.solver.OptimizerConfig;
import com.lwoptimizer.usecase.carpooling.CarpoolConstraints;
import com.lwoptimizer.usecase.carpooling.CarpoolDemoData;
import com.lwoptimizer.usecase.carpooling.domain.CarpoolPlan;
import com.lwoptimizer.usecase.carpooling.domain.CarpoolSettings;
import com.lwoptimizer.usecase.carpooling.domain.Driver;
import com.lwoptimizer.usecase.carpooling.domain.Location;
import com.lwoptimizer.usecase.carpooling.domain.Ride;
import com.lwoptimizer.usecase.carpooling.domain.Rider;
import com.lwoptimizer.usecase.carpooling.domain.RiderConflict;
import com.lwoptimizer.usecase.carpooling.domain.Route;
import io.swagger.v3.oas.annotations.media.Schema;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
public final class CarpoolingUseCase implements UseCase<CarpoolPlan, CarpoolingUseCase.Plan> {

    @Schema(name = "CarpoolPlan", description = "Drivers, riders and who picks up whom, in which order")
    public record Plan(
            PlaceDto destination,
            SettingsDto settings,
            List<DriverDto> drivers,
            List<RiderDto> riders,
            @Schema(description = "Pairs of riders who would rather not share a car", example = "[[\"Rose\", \"Sami\"]]")
            List<List<String>> conflicts,
            @Schema(accessMode = Schema.AccessMode.READ_ONLY) Double totalKm) {
    }

    @Schema(name = "Place")
    public record PlaceDto(String name, double latitude, double longitude) {
    }

    @Schema(name = "CarpoolSettings", description = "Assumptions about travel")
    public record SettingsDto(double averageSpeedKmh, double roadFactor, int boardingMinutes, int maxDetourMinutes) {
    }

    @Schema(name = "Driver")
    public record DriverDto(
            String name,
            PlaceDto home,
            @Schema(description = "Free passenger seats") int seats,
            @Schema(description = "Departure from home, in minutes after midnight", example = "445") int departureMinute,
            @Schema(description = "Latest arrival at the destination, in minutes after midnight", example = "540")
            int latestArrivalMinute,
            @Schema(description = "Names of the riders to pick up, in order; absent when nothing is planned yet")
            List<String> pickups,
            @Schema(accessMode = Schema.AccessMode.READ_ONLY) Double arrivalMinute,
            @Schema(accessMode = Schema.AccessMode.READ_ONLY) Double km,
            @Schema(accessMode = Schema.AccessMode.READ_ONLY) Long minutesLate,
            @Schema(description = "When each rider is picked up", accessMode = Schema.AccessMode.READ_ONLY)
            List<StopDto> stops) {
    }

    @Schema(name = "PickupStop")
    public record StopDto(String rider, double minute, long detourMinutes) {
    }

    @Schema(name = "Rider")
    public record RiderDto(
            String name,
            PlaceDto pickup,
            @Schema(description = "Earliest pickup, in minutes after midnight", example = "450") int readyMinute) {
    }

    @Override
    public Class<CarpoolPlan> solutionType() {
        return CarpoolPlan.class;
    }

    @Override
    public ConstraintProvider<CarpoolPlan> constraints() {
        return new CarpoolConstraints();
    }

    @Override
    public String configFile() {
        return "carpooling.yaml";
    }

    @Override
    public CarpoolPlan demo(OptimizerConfig config) {
        return CarpoolDemoData.lyonMorningCommute();
    }

    @Override
    public CarpoolPlan fromPlan(Plan plan, OptimizerConfig config) {
        if (plan.destination() == null || plan.drivers() == null || plan.riders() == null) {
            throw new IllegalArgumentException("A carpool plan needs a destination, drivers and riders");
        }
        Map<String, Rider> riders = new LinkedHashMap<>();
        for (RiderDto rider : plan.riders()) {
            riders.put(rider.name(), new Rider(rider.name(), location(rider.pickup()), rider.readyMinute()));
        }
        List<Driver> drivers = new ArrayList<>();
        for (DriverDto dto : plan.drivers()) {
            Driver driver = new Driver(dto.name(), location(dto.home()), dto.seats(), dto.departureMinute(),
                    dto.latestArrivalMinute());
            List<Rider> pickups = new ArrayList<>();
            for (String name : dto.pickups() == null ? List.<String>of() : dto.pickups()) {
                pickups.add(known(riders, name, "Driver " + dto.name() + " picks up"));
            }
            driver.setPickups(pickups);
            drivers.add(driver);
        }
        List<RiderConflict> conflicts = new ArrayList<>();
        for (List<String> pair : plan.conflicts() == null ? List.<List<String>>of() : plan.conflicts()) {
            if (pair.size() != 2) {
                throw new IllegalArgumentException("A conflict is a pair of rider names: " + pair);
            }
            conflicts.add(new RiderConflict(known(riders, pair.get(0), "A conflict names"),
                    known(riders, pair.get(1), "A conflict names")));
        }
        SettingsDto s = plan.settings();
        CarpoolSettings settings = s == null ? CarpoolSettings.defaults()
                : new CarpoolSettings(s.averageSpeedKmh(), s.roadFactor(), s.boardingMinutes(), s.maxDetourMinutes());
        return new CarpoolPlan(location(plan.destination()), settings, drivers, new ArrayList<>(riders.values()),
                conflicts);
    }

    @Override
    public Plan toPlan(CarpoolPlan plan) {
        List<DriverDto> drivers = new ArrayList<>();
        double totalKm = 0;
        for (Route route : plan.routes()) {
            Driver driver = route.driver();
            List<StopDto> stops = new ArrayList<>();
            for (Ride ride : route.rides()) {
                stops.add(new StopDto(ride.rider().name(), ride.pickupMinute(), ride.excessMinutes()));
            }
            totalKm += route.distanceKm();
            drivers.add(new DriverDto(driver.name(), place(driver.home()), driver.seats(), driver.departureMinute(),
                    driver.latestArrivalMinute(), driver.pickups().stream().map(Rider::name).toList(),
                    route.arrivalMinute(), route.distanceKm(), route.minutesLate(), stops));
        }
        List<RiderDto> riders = plan.riders().stream()
                .map(rider -> new RiderDto(rider.name(), place(rider.pickup()), rider.readyMinute())).toList();
        List<List<String>> conflicts = plan.conflicts().stream()
                .map(conflict -> List.of(conflict.first().name(), conflict.second().name())).toList();
        CarpoolSettings s = plan.settings();
        return new Plan(place(plan.destination()), new SettingsDto(s.averageSpeedKmh(), s.roadFactor(),
                s.boardingMinutes(), s.maxDetourMinutes()), drivers, riders, conflicts, totalKm);
    }

    private static Rider known(Map<String, Rider> riders, String name, String context) {
        Rider rider = riders.get(name);
        if (rider == null) {
            throw new IllegalArgumentException(context + " '" + name + "', who is not among the riders");
        }
        return rider;
    }

    private static Location location(PlaceDto place) {
        if (place == null) {
            throw new IllegalArgumentException("A place is missing");
        }
        return new Location(place.name(), place.latitude(), place.longitude());
    }

    private static PlaceDto place(Location location) {
        return new PlaceDto(location.name(), location.latitude(), location.longitude());
    }
}
