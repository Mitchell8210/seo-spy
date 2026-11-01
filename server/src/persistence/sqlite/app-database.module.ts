import { Module } from "@nestjs/common";
import { AppDatabase } from "./app-database.js";

@Module({ providers: [AppDatabase], exports: [AppDatabase] })
export class AppDatabaseModule {}
