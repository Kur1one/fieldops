import { describe, expect, it } from 'vitest';
import { fmtDateTime, fmtDuration, todayIso } from '../src/lib/shared/format';
import { distanceMeters, isValidIp, isValidMac, normalizeIpInput } from '../src/lib/shared/net';
import { formatTicketNumber, matchesWords, norm, suggestCityCode } from '../src/lib/shared/text';

describe('поиск (5.2)', () => {
  it('несколько слов в любом порядке', () => {
    expect(matchesWords(norm('Arena City Park C'), 'arena park')).toBe(true);
    expect(matchesWords(norm('Arena City Park C'), 'park arena')).toBe(true);
    expect(matchesWords(norm('Arena City Park C'), 'arena sport')).toBe(false);
  });
  it('без учёта регистра, ё/е, точек, дефисов и лишних пробелов', () => {
    expect(matchesWords(norm('Alem. Dara - C'), 'alem dara c')).toBe(true);
    expect(matchesWords(norm('Жезказган-Караганда'), 'жезказган караганда')).toBe(true);
    expect(matchesWords(norm('Пётр'), 'петр')).toBe(true);
    expect(norm('  A.B--C  ')).toBe('a b c');
  });
});

describe('нумерация (4)', () => {
  it('4 цифры, затем 5', () => {
    expect(formatTicketNumber('AST', 1)).toBe('AST-0001');
    expect(formatTicketNumber('AST', 9999)).toBe('AST-9999');
    expect(formatTicketNumber('AST', 10000)).toBe('AST-10000');
  });
  it('код транслитерацией, 3 латинские буквы, занятые обходятся', () => {
    expect(suggestCityCode('Семей')).toBe('SEM');
    expect(suggestCityCode('Семей', ['SEM'])).toMatch(/^[A-Z]{3}$/);
    expect(suggestCityCode('Семей', ['SEM'])).not.toBe('SEM');
    expect(suggestCityCode('Өскемен')).toBe('OSK');
    expect(suggestCityCode('Ая')).toMatch(/^[A-Z]{3}$/);
  });
});

describe('IP и MAC (8.1)', () => {
  it('IPv4', () => {
    expect(isValidIp('192.168.1.10')).toBe(true);
    expect(isValidIp('256.1.1.1')).toBe(false);
    expect(isValidIp('192.168.1')).toBe(false);
    expect(isValidIp('01.2.3.4')).toBe(false);
  });
  it('запятая → точка, пробелы удаляются', () => {
    expect(normalizeIpInput('192,168,1,10')).toBe('192.168.1.10');
    expect(normalizeIpInput(' 10. 0.0 .1 ')).toBe('10.0.0.1');
  });
  it('MAC через двоеточие или дефис', () => {
    expect(isValidMac('aa:bb:cc:dd:ee:ff')).toBe(true);
    expect(isValidMac('AA-BB-CC-DD-EE-FF')).toBe(true);
    expect(isValidMac('AA:BB-CC:DD:EE:FF')).toBe(false);
    expect(isValidMac('ZZ:BB:CC:DD:EE:FF')).toBe(false);
  });
});

describe('время и расстояние', () => {
  it('дд.мм.гггг чч:мм в поясе пользователя', () => {
    const d = new Date('2026-10-12T04:30:00Z');
    expect(fmtDateTime(d, 'Asia/Almaty')).toBe('12.10.2026 09:30');
    expect(fmtDateTime(d, 'Asia/Baku')).toBe('12.10.2026 08:30');
    expect(todayIso('Asia/Tashkent', new Date('2026-10-12T20:00:00Z'))).toBe('2026-10-13');
  });
  it('длительность ч:мм', () => {
    expect(fmtDuration(125)).toBe('2:05');
    expect(fmtDuration(0)).toBe('0:00');
  });
  it('расстояние', () => {
    const m = distanceMeters(51.128207, 71.430411, 51.128207, 71.437592);
    expect(m).toBeGreaterThan(490);
    expect(m).toBeLessThan(510);
  });
});
