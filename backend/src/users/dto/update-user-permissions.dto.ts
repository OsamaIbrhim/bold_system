import { ArrayUnique, IsArray, IsIn, IsString } from 'class-validator';
import { CAPABILITIES } from '../../auth/permissions';

export class UpdateUserPermissionsDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsIn(CAPABILITIES, { each: true })
  granted_capabilities: string[];

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  @IsIn(CAPABILITIES, { each: true })
  revoked_capabilities: string[];
}
