import { ForbiddenException, Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../identity/entities/user.entity';
import { Role } from '../identity/entities/role.entity';
import { Permission } from '../identity/entities/permission.entity';
import { UserRole } from '../identity/entities/user-role.entity';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from '../identity/dto/create-user.dto';
@Injectable()
export class AuthService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>, private readonly jwt: JwtService) {}
  async bootstrap(dto: CreateUserDto, suppliedToken?: string) {
    const expected = process.env.BOOTSTRAP_TOKEN ?? '';
    if (!expected || !suppliedToken || expected.length !== suppliedToken.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(suppliedToken))) throw new ForbiddenException('Invalid bootstrap token');
    if (await this.users.count() !== 0) throw new ConflictException('Bootstrap is closed because users already exist');
    const email = dto.email.toLowerCase();
    if (await this.users.findOne({ where: [{ email }, { username: dto.username }] })) throw new ConflictException('Email or username already exists');
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const { password, ...profile } = dto;
    const user = await this.users.save(this.users.create({ ...profile, email, passwordHash, isActive: true }));
    const permissionRepo = this.users.manager.getRepository(Permission);
    const roleRepo = this.users.manager.getRepository(Role);
    const assignmentRepo = this.users.manager.getRepository(UserRole);
    let rootPermission = await permissionRepo.findOneBy({ code: '*' });
    if (!rootPermission) rootPermission = await permissionRepo.save(permissionRepo.create({ code: '*', name: 'تمام مجوزها', description: 'مجوز مدیریتی اولیه سامانه' }));
    let adminRole = await roleRepo.findOne({ where: { code: 'SYSTEM_ADMIN' }, relations: { permissions: true } });
    if (!adminRole) adminRole = await roleRepo.save(roleRepo.create({ code: 'SYSTEM_ADMIN', name: 'مدیر سامانه', description: 'نقش مدیریتی اولیه', permissions: [rootPermission] }));
    await assignmentRepo.save(assignmentRepo.create({ userId: user.id, roleId: adminRole.id, organizationId: null, isActive: true }));
    return { id: user.id, username: user.username, email: user.email, firstName: user.firstName, lastName: user.lastName, role: 'SYSTEM_ADMIN' };
  }
  async login(dto: LoginDto) {
    const user = await this.users.createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('(user.username = :identity OR user.email = :identity)', { identity: dto.username.toLowerCase() })
      .andWhere('user.isActive = :active', { active: true }).getOne();
    if (!user?.passwordHash || !await bcrypt.compare(dto.password, user.passwordHash)) throw new UnauthorizedException('Invalid credentials');
    const payload = { sub: user.id, username: user.username, email: user.email };
    return { accessToken: await this.jwt.signAsync(payload), tokenType: 'Bearer', expiresIn: process.env.JWT_EXPIRES_IN ?? '8h', user: { id: user.id, username: user.username, email: user.email, firstName: user.firstName, lastName: user.lastName } };
  }
  async me(userId: string) {
    const user = await this.users.findOne({ where: { id: userId, isActive: true }, relations: { positions: { position: { unit: true } }, roles: { role: { permissions: true } } } });
    if (!user) throw new UnauthorizedException('User is no longer active');
    return { id: user.id, username: user.username, email: user.email, firstName: user.firstName, lastName: user.lastName, positions: user.positions, roles: user.roles };
  }
}