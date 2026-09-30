import { BadRequestException, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PrismaService } from "../common/prisma.service";
import { getValidator } from "../common/schema-registry";

// protocols/*.json lives at the repo root, three levels up from
// services/backend-api/src/protocols/.
const PROTOCOLS_DIR = path.resolve(__dirname, "../../../../protocols");

@Injectable()
export class ProtocolsService implements OnModuleInit {
  private readonly logger = new Logger(ProtocolsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.loadAndUpsertAll();
  }

  async loadAndUpsertAll() {
    const validate = getValidator("protocol-definition");
    const files = (await readdir(PROTOCOLS_DIR)).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      const raw = await readFile(path.join(PROTOCOLS_DIR, file), "utf-8");
      const parsed = JSON.parse(raw);

      if (!validate(parsed)) {
        // A draft protocol that fails its own schema must block boot, not load
        // silently - see docs/claims-and-scope.md on protocol data discipline.
        throw new BadRequestException({
          message: `${file} does not conform to protocol-definition.schema.json`,
          errors: validate.errors,
        });
      }

      // ajv's ValidateFunction is a type guard (`data is T`) with T defaulting to
      // `unknown`, so `parsed` narrows to `unknown` past the guard above rather
      // than staying `any` - cast explicitly to the handful of fields used here.
      const definition = parsed as { protocolId: string; version: string; status: string };

      await this.prisma.protocolVersion.upsert({
        where: { protocolKey_version: { protocolKey: definition.protocolId, version: definition.version } },
        create: {
          protocolKey: definition.protocolId,
          version: definition.version,
          definition,
          status: definition.status,
        },
        update: { definition, status: definition.status },
      });
      this.logger.log(`Loaded protocol ${definition.protocolId}@${definition.version} (status=${definition.status})`);
    }
  }

  async listAll() {
    return this.prisma.protocolVersion.findMany({ orderBy: { protocolKey: "asc" } });
  }

  async get(protocolKey: string, version: string) {
    return this.prisma.protocolVersion.findUniqueOrThrow({
      where: { protocolKey_version: { protocolKey, version } },
    });
  }
}
