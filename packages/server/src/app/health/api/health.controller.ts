import { Public } from "@nestjs/authentication";
import { Controller, Get, Inject } from "@nestjs/common";
import { HealthCheck, HealthCheckService, MikroOrmHealthIndicator } from "@nestjs/terminus";

/**
 * Server health (`@nestjs/terminus`): `200` with `{ status: "ok", … }`, `503` if the database does not answer or during
 * shutdown. Public: used by the Docker probe.
 */
@Controller()
export class HealthController {
	constructor(
		@Inject(HealthCheckService) private readonly health: HealthCheckService,
		@Inject(MikroOrmHealthIndicator) private readonly database: MikroOrmHealthIndicator,
	) {}

	@Public()
	@Get("health")
	@HealthCheck()
	check() {
		return this.health.check([() => this.database.pingCheck("database")]);
	}
}
