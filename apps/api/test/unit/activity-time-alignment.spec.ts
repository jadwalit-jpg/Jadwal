/**
 * Activity check-in/out time validation, split by concern:
 *
 *  - DTO layer (vendor create/update + admin update): FORMAT only — any valid
 *    HH:MM. It must NOT force the 30-min grid, so a DAILY activity's day-boundary
 *    check-in (e.g. 15:15) isn't blocked.
 *  - Service layer (assertHourlyTimesConsistent): enforces the :00/:30 grid for
 *    HOURLY only (an off-grid HOURLY time makes every slot unbookable), and leaves
 *    DAILY alone. This is where the "8:15 is rejected for hourly" rule now lives.
 *
 * Fails if the DTO regex is dropped OR the HOURLY :30 guard is dropped.
 */
import 'reflect-metadata';
import { validate } from 'class-validator';
import { CreateActivityDto } from '../../src/vendor/dto/create-activity.dto';
import { UpdateActivityDto } from '../../src/vendor/dto/update-activity.dto';
import { UpdateActivityDto as AdminUpdateActivityDto } from '../../src/admin/dto/update-activity.dto';
import { assertHourlyTimesConsistent } from '../../src/common/validators/hourly-activity';

const DTOS: [string, new () => Record<string, unknown>][] = [
  ['vendor CreateActivityDto', CreateActivityDto as never],
  ['vendor UpdateActivityDto', UpdateActivityDto as never],
  ['admin UpdateActivityDto', AdminUpdateActivityDto as never],
];

async function fieldErrors(Ctor: new () => Record<string, unknown>, field: string, value: string) {
  const dto = new Ctor();
  dto[field] = value;
  const errs = await validate(dto as object);
  return errs.filter((e) => e.property === field);
}

describe('activity DTO — checkInTime/checkOutTime format (any valid HH:MM)', () => {
  describe.each(DTOS)('%s', (_name, Ctor) => {
    // :15/:45 are now VALID at the DTO layer (DAILY may use them); the :30 grid is
    // a HOURLY-only rule enforced by the service, not the DTO.
    it.each(['09:00', '09:30', '08:15', '08:45', '00:00', '23:59', '14:00'])('accepts valid %s', async (v) => {
      expect(await fieldErrors(Ctor, 'checkInTime', v)).toHaveLength(0);
      expect(await fieldErrors(Ctor, 'checkOutTime', v)).toHaveLength(0);
    });

    it.each(['9:00', '24:00', '18:60', '25:30', 'xx:yy', '9', '09:0'])('rejects malformed %s', async (v) => {
      expect((await fieldErrors(Ctor, 'checkInTime', v)).length).toBeGreaterThan(0);
      expect((await fieldErrors(Ctor, 'checkOutTime', v)).length).toBeGreaterThan(0);
    });
  });
});

describe('assertHourlyTimesConsistent — :30 grid enforced for HOURLY only', () => {
  const hourly = (checkInTime: string, checkOutTime: string) =>
    () => assertHourlyTimesConsistent({ bookingType: 'HOURLY', checkInTime, checkOutTime, durationValue: 1 });

  it.each(['09:00', '09:30', '10:00', '10:30'])('HOURLY accepts on-grid %s', (t) => {
    expect(hourly(t, '21:00')).not.toThrow();
  });

  it.each(['08:15', '08:45', '09:05', '10:20'])('HOURLY rejects off-grid %s', (t) => {
    expect(hourly(t, '21:00')).toThrow(/on the hour or half-hour/i);
  });

  it('HOURLY rejects an off-grid checkOutTime', () => {
    expect(hourly('09:00', '21:15')).toThrow(/on the hour or half-hour/i);
  });

  it('DAILY is exempt — any valid off-grid time is fine (day boundary, not a slot grid)', () => {
    expect(() =>
      assertHourlyTimesConsistent({ bookingType: 'DAILY', checkInTime: '15:15', checkOutTime: '11:45', durationValue: null }),
    ).not.toThrow();
  });
});
