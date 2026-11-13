package com.lwoptimizer.ui.usecase;

import com.lwoptimizer.constraint.ConstraintProvider;
import com.lwoptimizer.solver.OptimizerConfig;
import com.lwoptimizer.ui.api.dto.FieldDto;
import com.lwoptimizer.ui.api.dto.FieldDto.Option;
import com.lwoptimizer.usecase.cvrp.CvrpConstraints;
import com.lwoptimizer.usecase.cvrp.CvrpData;
import com.lwoptimizer.usecase.cvrp.domain.Customer;
import com.lwoptimizer.usecase.cvrp.domain.Depot;
import com.lwoptimizer.usecase.cvrp.domain.Location;
import com.lwoptimizer.usecase.cvrp.domain.RoutingPlan;
import com.lwoptimizer.usecase.cvrp.domain.TravelMatrix;
import com.lwoptimizer.usecase.cvrp.domain.Vehicle;
import com.lwoptimizer.usecase.cvrp.travel.TravelSettings;
import io.swagger.v3.oas.annotations.media.Schema;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

@Component
public final class VrpUseCase implements UseCase<RoutingPlan, VrpUseCase.Plan> {

    private static final String TRAVEL = "Travel times";

    @Schema(name = "RoutingPlan", description = "A depot, customers, a fleet and the routes")
    public record Plan(
            SiteDto depot,
            List<CustomerDto> customers,
            List<VehicleDto> vehicles,
            @Schema(description = "Customers that no vehicle visits", accessMode = Schema.AccessMode.READ_ONLY)
            List<String> unvisited,
            @Schema(accessMode = Schema.AccessMode.READ_ONLY) Double totalKm,
            @Schema(description = "Total driving time", accessMode = Schema.AccessMode.READ_ONLY) Long totalMinutes,
            @Schema(description = "Where travel times come from", accessMode = Schema.AccessMode.READ_ONLY)
            String travelSource) {
    }

    @Schema(name = "Depot")
    public record SiteDto(
            @Schema(example = "Depot Lyon Gerland") String name,
            @Schema(description = "Postal address; geocoded with Nominatim when the coordinates are absent",
                    example = "Gerland, Lyon, France") String address,
            @Schema(example = "45.728") Double latitude,
            @Schema(example = "4.83") Double longitude) {
    }

    @Schema(name = "Customer")
    public record CustomerDto(
            @Schema(example = "Villeurbanne") String name,
            @Schema(description = "Postal address; geocoded with Nominatim when the coordinates are absent",
                    example = "Villeurbanne, Rhone, France") String address,
            @Schema(example = "45.7719") Double latitude,
            @Schema(example = "4.8902") Double longitude,
            @Schema(description = "Quantity to deliver", example = "12") int demand) {
    }

    @Schema(name = "Vehicle")
    public record VehicleDto(
            @Schema(example = "V1") String name,
            @Schema(example = "100") int capacity,
            @Schema(description = "Names of the customers visited, in order; absent when nothing is planned yet")
            List<String> visits,
            @Schema(description = "Number of visits at the start of the route that must not change", example = "2")
            int pinnedVisits,
            @Schema(description = "True to keep the whole route as it is") boolean pinned,
            @Schema(accessMode = Schema.AccessMode.READ_ONLY) Integer load,
            @Schema(accessMode = Schema.AccessMode.READ_ONLY) Double km,
            @Schema(description = "Driving time", accessMode = Schema.AccessMode.READ_ONLY) Long minutes) {
    }

    /** Travel matrices already computed, so that editing a plan does not call the routing service again. */
    private final Map<String, TravelMatrix> matrices = new LinkedHashMap<>() {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, TravelMatrix> eldest) {
            return size() > 16;
        }
    };

    @Override
    public Class<RoutingPlan> solutionType() {
        return RoutingPlan.class;
    }

    @Override
    public ConstraintProvider<RoutingPlan> constraints() {
        return new CvrpConstraints();
    }

    @Override
    public String configFile() {
        return "cvrp.yaml";
    }

    @Override
    public List<FieldDto> problemFields() {
        String source = "problem.travel.source";
        return List.of(
                FieldDto.select(source, "Source", TRAVEL, List.of(
                                new Option("straight-line", "Straight line (offline)"),
                                new Option("osrm", "Road network (OpenStreetMap, OSRM)"),
                                new Option("random", "Random (for tests)")),
                        "Where the travel time and distance between two sites come from."),
                FieldDto.number("problem.travel.speedKmh", "Average speed", TRAVEL, 5, 130, 1, "km/h", true,
                        "Converts distances into times.").when(source, "straight-line"),
                FieldDto.number("problem.travel.roadFactor", "Road factor", TRAVEL, 1, 3, 0.05, null, true,
                        "Road distance divided by straight-line distance.").when(source, "straight-line"),
                FieldDto.text("problem.travel.osrmUrl", "OSRM server", TRAVEL,
                        "The public demonstration server is shared and rate-limited; use your own for regular work.")
                        .when(source, "osrm"),
                FieldDto.number("problem.travel.randomMinMinutes", "Shortest travel time", TRAVEL, 0, 600, 1, "min", true,
                        "Lower bound of the time drawn between two sites.").when(source, "random"),
                FieldDto.number("problem.travel.randomMaxMinutes", "Longest travel time", TRAVEL, 0, 600, 1, "min", true,
                        "Upper bound of the time drawn between two sites.").when(source, "random"),
                FieldDto.number("problem.travel.randomSeed", "Seed", TRAVEL, 0, 1_000_000, 1, null, true,
                        "The same seed draws the same travel times.").when(source, "random"));
    }

    @Override
    public void checkProblemSettings(OptimizerConfig config) {
        TravelSettings.fromConfig(config.problem());
    }

    @Override
    public RoutingPlan demo(OptimizerConfig config) {
        return fromPlan(toPlan(CvrpData.demo()), config);
    }

    @Override
    public RoutingPlan fromPlan(Plan plan, OptimizerConfig config) {
        if (plan.depot() == null || plan.customers() == null || plan.vehicles() == null) {
            throw new IllegalArgumentException("A routing plan needs a depot, customers and vehicles");
        }
        TravelSettings travel = TravelSettings.fromConfig(config.problem());

        Depot depot = new Depot(plan.depot().name(), plan.depot().address(),
                locate(travel, plan.depot().name(), plan.depot().address(), plan.depot().latitude(), plan.depot().longitude()));
        List<Customer> customers = new ArrayList<>();
        for (CustomerDto dto : plan.customers()) {
            customers.add(new Customer(dto.name(), dto.address(),
                    locate(travel, dto.name(), dto.address(), dto.latitude(), dto.longitude()), dto.demand()));
        }
        List<Vehicle> vehicles = plan.vehicles().stream()
                .map(dto -> new Vehicle(dto.name(), dto.capacity())).toList();

        List<Location> sites = new ArrayList<>();
        sites.add(depot.location());
        customers.forEach(customer -> sites.add(customer.location()));
        RoutingPlan routingPlan = RoutingPlan.of(depot, customers, vehicles, matrix(travel, sites));

        // The assignment and the pins to start from, if any.
        for (int v = 0; v < vehicles.size(); v++) {
            VehicleDto dto = plan.vehicles().get(v);
            List<Customer> visits = new ArrayList<>();
            for (String name : dto.visits() == null ? List.<String>of() : dto.visits()) {
                Customer customer = routingPlan.customer(name);
                if (customer == null) {
                    throw new IllegalArgumentException("Vehicle " + dto.name() + " visits '" + name
                            + "', which is not among the customers");
                }
                visits.add(customer);
            }
            if (dto.pinnedVisits() < 0 || dto.pinnedVisits() > visits.size()) {
                throw new IllegalArgumentException("Vehicle " + dto.name() + " pins " + dto.pinnedVisits()
                        + " visits but its route has " + visits.size());
            }
            Vehicle vehicle = vehicles.get(v);
            vehicle.setVisits(visits);
            vehicle.setPinnedVisits(dto.pinnedVisits());
            vehicle.setPinned(dto.pinned());
        }
        return routingPlan;
    }

    @Override
    public Plan toPlan(RoutingPlan plan) {
        TravelMatrix matrix = plan.matrix();
        List<CustomerDto> customers = plan.customers().stream()
                .map(customer -> new CustomerDto(customer.name(), customer.address(), customer.location().latitude(),
                        customer.location().longitude(), customer.demand()))
                .toList();
        List<VehicleDto> vehicles = plan.vehicles().stream()
                .map(vehicle -> new VehicleDto(vehicle.name(), vehicle.capacity(),
                        vehicle.visits().stream().map(Customer::name).toList(), vehicle.pinnedVisits(),
                        vehicle.isPinned(), vehicle.load(), vehicle.metres(matrix) / 1000.0,
                        Math.round(vehicle.seconds(matrix) / 60.0)))
                .toList();
        Depot depot = plan.depot();
        return new Plan(new SiteDto(depot.name(), depot.address(), depot.location().latitude(),
                depot.location().longitude()), customers, vehicles,
                plan.unvisitedCustomers().stream().map(Customer::name).toList(), plan.totalMetres() / 1000.0,
                Math.round(plan.totalSeconds() / 60.0), matrix.source());
    }

    /** Geocodes an address with the Nominatim service of the settings. */
    public Optional<Location> geocode(String address, OptimizerConfig config) {
        return TravelSettings.fromConfig(config.problem()).geocoder().geocode(address);
    }

    private static Location locate(TravelSettings travel, String name, String address, Double latitude,
                                   Double longitude) {
        if (latitude != null && longitude != null) {
            return new Location(latitude, longitude);
        }
        if (address == null || address.isBlank()) {
            throw new IllegalArgumentException(name + " has neither coordinates nor an address to geocode");
        }
        return travel.geocoder().geocode(address).orElseThrow(() -> new IllegalArgumentException(
                "The address of " + name + " was not found by the geocoding service: " + address));
    }

    private synchronized TravelMatrix matrix(TravelSettings travel, List<Location> sites) {
        String key = travel + "|" + sites;
        TravelMatrix matrix = matrices.get(key);
        if (matrix == null) {
            matrix = travel.matrixSource().compute(sites);
            matrices.put(key, matrix);
        }
        return matrix;
    }
}
