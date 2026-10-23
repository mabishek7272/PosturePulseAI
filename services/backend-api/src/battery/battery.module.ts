import { Module } from "@nestjs/common";
import { BatteryController } from "./battery.controller";
import { BatteryService } from "./battery.service";

@Module({
  controllers: [BatteryController],
  // useFactory so Nest does not try to inject the constructor's optional
  // directory argument (tests pass one; the app uses REFERENCES_DIR/default).
  providers: [{ provide: BatteryService, useFactory: () => new BatteryService() }],
  exports: [BatteryService],
})
export class BatteryModule {}
