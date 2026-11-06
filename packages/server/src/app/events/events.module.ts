import { Module } from "@nestjs/common";
import { EventsController } from "@app/events/api/events.controller.js";

@Module({ controllers: [EventsController] })
export class EventsModule {}
