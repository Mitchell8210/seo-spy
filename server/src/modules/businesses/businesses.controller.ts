import { Controller, Get, Param } from "@nestjs/common";
import { BusinessesService } from "./businesses.service.js";
import {
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import { ApiErrorDto, DashboardDto } from "../../contracts/responses.dto.js";

@Controller("businesses")
@ApiTags("Businesses")
export class BusinessesController {
  constructor(private readonly businesses: BusinessesService) {}

  @Get(":businessId/dashboard")
  @ApiOperation({
    summary: "Get the business dashboard",
    description:
      "Returns the latest completed results separately from any active investigation.",
  })
  @ApiParam({ name: "businessId", example: "demo-guzman" })
  @ApiOkResponse({ type: DashboardDto })
  @ApiNotFoundResponse({ type: ApiErrorDto })
  @ApiInternalServerErrorResponse({ type: ApiErrorDto })
  dashboard(@Param("businessId") id: string): Promise<DashboardDto> {
    return this.businesses.dashboard(id);
  }
}
