import { Controller, Get } from "@nestjs/common";
import { BatteryService } from "./battery.service";

/** Public: the battery holds instructions and metric keys only, no subject data. */
@Controller("assessment-battery")
export class BatteryController {
  constructor(private readonly batteryService: BatteryService) {}

  @Get()
  get() {
    return this.batteryService.battery;
  }
}
