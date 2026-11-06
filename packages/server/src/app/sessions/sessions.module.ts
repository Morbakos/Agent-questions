import { Module } from "@nestjs/common";
import { AdminSessionsController } from "@app/sessions/api/admin-sessions.controller.js";
import { SessionsController } from "@app/sessions/api/sessions.controller.js";
import { SessionsService } from "./sessions.service.js";

@Module({
	controllers: [SessionsController, AdminSessionsController],
	providers: [SessionsService],
	exports: [SessionsService],
})
export class SessionsModule {}
