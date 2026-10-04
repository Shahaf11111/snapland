import { Module } from "@nestjs/common";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { AuthRepository } from "./auth.repository";
import { TokenService } from "./token.service";
import { JwtStrategy } from "./jwt.strategy";

@Module({
  imports: [PassportModule],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, TokenService, JwtStrategy],
  exports: [TokenService],
})
export class AuthModule {}
