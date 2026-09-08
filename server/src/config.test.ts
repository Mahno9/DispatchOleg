import { describe, expect, it } from 'vitest';
import { assertProductionSecrets } from './config.js';

const real = {
  ADMIN_LOGIN: 'dispatcher',
  ADMIN_PASSWORD: 'S3cr3t-p4ss',
  COOKIE_SECRET: 'b6f0c2a1e9d4',
};

describe('assertProductionSecrets', () => {
  it('в dev не мешает: дефолты допустимы', () => {
    expect(() => assertProductionSecrets({})).not.toThrow();
    expect(() => assertProductionSecrets({ NODE_ENV: 'development' })).not.toThrow();
  });

  it('в production падает и перечисляет все дефолтные переменные', () => {
    expect(() => assertProductionSecrets({ NODE_ENV: 'production' })).toThrow(
      /ADMIN_LOGIN, ADMIN_PASSWORD, COOKIE_SECRET/,
    );
  });

  it('в production называет ровно те переменные, что остались дефолтными', () => {
    const call = () =>
      assertProductionSecrets({ NODE_ENV: 'production', ...real, ADMIN_PASSWORD: 'admin' });
    expect(call).toThrow(/ADMIN_PASSWORD/);
    expect(call).not.toThrow(/COOKIE_SECRET/);
  });

  it('переменная, выставленная в дефолтное значение руками, тоже считается дефолтной', () => {
    expect(() =>
      assertProductionSecrets({
        NODE_ENV: 'production',
        ...real,
        COOKIE_SECRET: 'dev-secret-change-me',
      }),
    ).toThrow(/COOKIE_SECRET/);
  });

  it('со своими значениями production стартует', () => {
    expect(() => assertProductionSecrets({ NODE_ENV: 'production', ...real })).not.toThrow();
  });
});
