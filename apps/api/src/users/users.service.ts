import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { User } from '@prisma/client';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { nowInTimezone } from '../common/validators/timezone';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  /**
   * Internal auth use ONLY — opts back into password (omitted globally).
   * NEVER return this directly in an API response.
   *
   * §B9 — soft-deleted users have their email reassigned to
   * `<id>@deleted.local`, so a login attempt with the original address
   * naturally finds nothing. The explicit `deletedAt: null` filter is
   * defence in depth: if anonymisation ever skipped a row (race / bug)
   * the deleted user still cannot authenticate.
   */
  async findOneForAuth(email: string): Promise<User | null> {
    return this.prisma.client.user.findFirst({
      where: { email, deletedAt: null },
      omit: { password: false },
    } as any) as Promise<User | null>;
  }

  /**
   * Internal auth use ONLY — opts back into password (omitted globally).
   * NEVER return this directly in an API response. §B9 — refuses to
   * return a soft-deleted user even if their id is known.
   */
  async findByIdForAuth(id: string): Promise<User | null> {
    return this.prisma.client.user.findFirst({
      where: { id, deletedAt: null },
      omit: { password: false },
    } as any) as Promise<User | null>;
  }

  async create(data: { fullName: string; email: string; password: string; phone?: string; role?: string; preferredLanguage?: 'EN' | 'AR'; termsAcceptedAt?: Date; termsAcceptedVersion?: string }): Promise<User> {
    const bcryptRounds = Number(process.env.BCRYPT_ROUNDS || 12);
    const hashedPassword = await bcrypt.hash(data.password, bcryptRounds);
    return this.prisma.client.user.create({
      data: {
        fullName: data.fullName,
        email: data.email,
        password: hashedPassword,
        ...(data.phone ? { phone: data.phone } : {}),
        ...(data.role ? { role: data.role as any } : {}),
        // Omitted → schema default 'EN'. Set from the Accept-Language header
        // captured at registration (see AuthService.registerAndLogin).
        ...(data.preferredLanguage ? { preferredLanguage: data.preferredLanguage } : {}),
        // Terms acceptance captured at registration (the register DTO requires
        // termsAccepted === true). Stamped together so version is never set
        // without a timestamp.
        ...(data.termsAcceptedAt ? { termsAcceptedAt: data.termsAcceptedAt, termsAcceptedVersion: data.termsAcceptedVersion } : {}),
      },
    });
  }

  // ─── Customer profile ──────────────────────────────────────────────────────

  async getProfile(userId: string) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        emailVerified: true,
        role: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    // Booking stats — runs in parallel
    const [totalBookings, confirmedForUpcoming, completedCount, totalSpentAgg] = await Promise.all([
      this.prisma.client.booking.count({
        where: { customerId: userId },
      }),
      // "Upcoming" must be judged per-activity-timezone: startDatetime is
      // local-wall-clock tagged-UTC, and a customer's bookings can span
      // countries, so a single `> new Date()` (raw UTC) over-counts a
      // just-started booking by each activity's offset. Fetch the CONFIRMED
      // bookings + their tz and count in-app (a customer's confirmed set is
      // small — confirmed bookings become COMPLETED once they pass).
      this.prisma.client.booking.findMany({
        where: { customerId: userId, status: 'CONFIRMED' },
        select: {
          startDatetime: true,
          activity: { select: { country: { select: { defaultTimezone: true } } } },
        },
      }),
      this.prisma.client.booking.count({
        where: { customerId: userId, status: 'COMPLETED' },
      }),
      this.prisma.client.booking.aggregate({
        where: { customerId: userId, status: { in: ['CONFIRMED', 'COMPLETED'] } },
        _sum: { totalPrice: true, serviceFee: true },
      }),
    ]);

    const upcomingCount = confirmedForUpcoming.filter(
      (b) => b.startDatetime.getTime() > nowInTimezone(b.activity?.country?.defaultTimezone ?? 'UTC').getTime(),
    ).length;

    const totalSpent =
      Number(totalSpentAgg._sum.totalPrice ?? 0) +
      Number(totalSpentAgg._sum.serviceFee ?? 0);

    return {
      ...user,
      stats: {
        totalBookings,
        upcomingCount,
        completedCount,
        totalSpent: Math.round(totalSpent * 100) / 100,
      },
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.client.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const updated = await this.prisma.client.user.update({
      where: { id: userId },
      data: {
        ...(dto.fullName !== undefined && { fullName: dto.fullName }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        emailVerified: true,
        role: true,
        createdAt: true,
      },
    });

    return updated;
  }

  // ─── Loyalty points ──────────────────────────────────────────────────────

  /**
   * Returns the customer's loyalty points balance and the public-facing loyalty
   * rates the booking page shows the customer: pointsPerQar (EARN rate — needed
   * for an accurate "you'll earn N points" preview), qarPerPoint (redemption
   * rate), and minRedemption. All three are rates the customer is shown on the
   * checkout page — public-facing, NOT sensitive internal settings (no cost,
   * margin, or commission data is exposed).
   */
  async getPoints(userId: string) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      select: { loyaltyPoints: true },
    });
    if (!user) throw new NotFoundException('User not found');

    // Load loyalty config singleton (create with defaults if missing)
    let config = await this.prisma.client.loyaltyConfig.findUnique({
      where: { id: 'singleton' },
    });
    if (!config) {
      config = await this.prisma.client.loyaltyConfig.create({
        data: { id: 'singleton' },
      });
    }

    return {
      // loyaltyPoints is a Decimal column (QAR-denominated) — convert to a JS
      // number so it serialises as a JSON number, not a Decimal string.
      loyaltyPoints: Number(user.loyaltyPoints),
      pointsPerQar: config.pointsPerQar.toNumber(),
      qarPerPoint: config.qarPerPoint.toNumber(),
      minRedemption: config.minRedemption,
    };
  }
}
