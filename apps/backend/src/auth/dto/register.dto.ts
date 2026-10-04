import { Transform } from "class-transformer";
import { MinLength, IsEmail, IsString, Length, MaxLength, Matches } from "class-validator";

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(8, 200)
  password!: string;

  @IsString()
  @MaxLength(200)
  @MinLength(1)
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @Matches(/^[^\u0000]*$/, { message: "name must not contain null characters" })
  name!: string;
}
