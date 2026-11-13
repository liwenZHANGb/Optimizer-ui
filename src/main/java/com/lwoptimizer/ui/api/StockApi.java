package com.lwoptimizer.ui.api;

import com.lwoptimizer.ui.service.ConfigurationService;
import com.lwoptimizer.ui.service.JobService;
import com.lwoptimizer.ui.usecase.StockUseCase;
import com.lwoptimizer.usecase.stock.domain.StockPlan;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/stock")
@Tag(name = "Stock management",
        description = "Decide what to order in each period so that demand is always served and the warehouse "
                + "never overflows, at the lowest holding and ordering cost.")
public class StockApi extends UseCaseApi<StockPlan, StockUseCase.Plan> {

    public StockApi(StockUseCase useCase, JobService jobs, ConfigurationService configurations) {
        super(useCase, jobs, configurations);
    }
}
