package com.lwoptimizer.ui.usecase;

import com.lwoptimizer.constraint.ConstraintProvider;
import com.lwoptimizer.solver.OptimizerConfig;
import com.lwoptimizer.usecase.stock.StockConstraints;
import com.lwoptimizer.usecase.stock.StockData;
import com.lwoptimizer.usecase.stock.domain.Product;
import com.lwoptimizer.usecase.stock.domain.StockLevel;
import com.lwoptimizer.usecase.stock.domain.StockPlan;
import com.lwoptimizer.usecase.stock.domain.StockSettings;
import com.lwoptimizer.usecase.stock.domain.WarehouseLoad;
import io.swagger.v3.oas.annotations.media.Schema;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

@Component
public final class StockUseCase implements UseCase<StockPlan, StockUseCase.Plan> {

    @Schema(name = "StockPlan", description = "Products, their demand and what to order in each period")
    public record Plan(
            @Schema(description = "Number of periods of the planning horizon", example = "12") int periods,
            @Schema(description = "Space available at the end of every period", example = "450") int warehouseCapacity,
            List<ProductDto> products,
            @Schema(description = "Space used at the end of each period", accessMode = Schema.AccessMode.READ_ONLY)
            List<Integer> warehouseLoad) {
    }

    @Schema(name = "Product")
    public record ProductDto(
            @Schema(example = "Bolts") String name,
            @Schema(example = "40") int initialStock,
            @Schema(description = "Level the stock should not fall below", example = "20") int safetyStock,
            @Schema(description = "Orders are whole numbers of lots", example = "50") int lotSize,
            @Schema(description = "Largest order, in lots", example = "4") int maxLots,
            @Schema(description = "Warehouse space taken by one unit", example = "1") int unitVolume,
            @Schema(description = "Cost of keeping one unit for one period", example = "1") int holdingCost,
            @Schema(description = "Fixed cost of placing an order", example = "120") int orderCost,
            @Schema(description = "Units consumed in each period") List<Integer> demand,
            @Schema(description = "Units ordered in each period; absent when nothing is planned yet")
            List<Integer> orders,
            @Schema(description = "Stock at the end of each period; negative means unserved demand",
                    accessMode = Schema.AccessMode.READ_ONLY) List<Integer> stock) {
    }

    @Override
    public Class<StockPlan> solutionType() {
        return StockPlan.class;
    }

    @Override
    public ConstraintProvider<StockPlan> constraints() {
        return new StockConstraints();
    }

    @Override
    public String configFile() {
        return "stock.yaml";
    }

    @Override
    public StockPlan demo(OptimizerConfig config) {
        return StockData.demo();
    }

    @Override
    public StockPlan fromPlan(Plan plan, OptimizerConfig config) {
        if (plan.products() == null || plan.products().isEmpty()) {
            throw new IllegalArgumentException("A stock plan needs at least one product");
        }
        List<Product> products = new ArrayList<>();
        for (ProductDto dto : plan.products()) {
            if (dto.demand() == null || dto.demand().size() != plan.periods()) {
                throw new IllegalArgumentException("Product " + dto.name() + " needs a demand for each of the "
                        + plan.periods() + " periods");
            }
            products.add(new Product(dto.name(), dto.initialStock(), dto.safetyStock(), dto.lotSize(), dto.maxLots(),
                    dto.unitVolume(), dto.holdingCost(), dto.orderCost(), dto.demand()));
        }
        StockPlan stockPlan = StockPlan.of(products, new StockSettings(plan.periods(), plan.warehouseCapacity()));
        for (int p = 0; p < products.size(); p++) {
            List<Integer> orders = plan.products().get(p).orders();
            if (orders == null) {
                continue;
            }
            for (int t = 0; t < Math.min(orders.size(), plan.periods()); t++) {
                int quantity = orders.get(t) == null ? 0 : orders.get(t);
                Product product = products.get(p);
                if (quantity < 0 || quantity > product.maxOrder() || quantity % product.lotSize() != 0) {
                    throw new IllegalArgumentException(product.name() + " cannot be ordered in a quantity of " + quantity
                            + ": orders are multiples of " + product.lotSize() + " up to " + product.maxOrder());
                }
                if (quantity > 0) {
                    stockPlan.replenishment(p, t).setQuantity(quantity);
                }
            }
        }
        return stockPlan;
    }

    @Override
    public Plan toPlan(StockPlan plan) {
        int periods = plan.settings().periods();
        List<StockLevel> levels = plan.stockLevels();
        List<ProductDto> products = new ArrayList<>();
        for (int p = 0; p < plan.products().size(); p++) {
            Product product = plan.products().get(p);
            List<Integer> orders = new ArrayList<>();
            List<Integer> stock = new ArrayList<>();
            for (int t = 0; t < periods; t++) {
                orders.add(plan.replenishment(p, t).quantity());
                stock.add(levels.get(p * periods + t).level());
            }
            products.add(new ProductDto(product.name(), product.initialStock(), product.safetyStock(),
                    product.lotSize(), product.maxLots(), product.unitVolume(), product.holdingCost(),
                    product.orderCost(), product.demand(), orders, stock));
        }
        return new Plan(periods, plan.settings().warehouseCapacity(), products,
                plan.warehouseLoads().stream().map(WarehouseLoad::volume).toList());
    }
}
