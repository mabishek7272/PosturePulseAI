import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { MlClientService } from "./ml-client.service";

/**
 * Separated from MlIntegrationModule so other modules (SessionsModule,
 * MovementModule) can depend on just the HTTP client without pulling in
 * MlIntegrationModule's controllers/consumers - and, critically, without
 * creating a module import cycle (MlIntegrationModule -> MovementModule ->
 * MlIntegrationModule would otherwise result).
 */
@Module({
  imports: [ConfigModule],
  providers: [MlClientService],
  exports: [MlClientService],
})
export class MlClientModule {}
