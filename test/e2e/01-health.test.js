import supertest from 'supertest';
import app from '../../src/app.js';

const req = supertest(app);

describe('01 — Health Check', () => {
  it('GET /api/health → 200 OK', async () => {
    const res = await req.get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
