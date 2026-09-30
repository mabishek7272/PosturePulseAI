import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import * as express from "express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  // Express's default 100kb body limit is far too small for a base64-encoded
  // camera frame (see FramesController) - raised to accommodate one frame per
  // request in this phase's synchronous-REST transport (ADR-003).
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`backend-api listening on :${port}`);
}

bootstrap();
