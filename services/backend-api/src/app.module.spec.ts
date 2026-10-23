import { Test } from "@nestjs/testing";
import { randomBytes } from "node:crypto";
import { AnalysisJobRunner } from "./analysis/analysis-job-runner";
import { AppModule } from "./app.module";
import { PrismaService } from "./common/prisma.service";
import { ReportsService } from "./reports/reports.service";

// Dependency-injection smoke test: every module wires up with a stand-in database.
describe("AppModule", () => {
  const original = { key: process.env.PATIENT_DATA_KEY, conc: process.env.ANALYSIS_CONCURRENCY };
  beforeAll(() => {
    process.env.PATIENT_DATA_KEY = randomBytes(32).toString("base64");
    process.env.ANALYSIS_CONCURRENCY = "0";
  });
  afterAll(() => {
    if (original.key === undefined) delete process.env.PATIENT_DATA_KEY;
    else process.env.PATIENT_DATA_KEY = original.key;
    if (original.conc === undefined) delete process.env.ANALYSIS_CONCURRENCY;
    else process.env.ANALYSIS_CONCURRENCY = original.conc;
  });

  it("wires every provider, including the M1 clip, analysis, report and patient modules", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();
    expect(moduleRef.get(AnalysisJobRunner)).toBeInstanceOf(AnalysisJobRunner);
    expect(moduleRef.get(ReportsService)).toBeInstanceOf(ReportsService);
    await moduleRef.close();
  });
});
