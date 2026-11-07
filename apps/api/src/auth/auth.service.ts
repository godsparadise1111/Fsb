import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../identity/entities/user.entity';
import { LoginDto } from './dto/login.dto';
@Injectable()
export class AuthService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>, private readonly jwt: JwtService) {}
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