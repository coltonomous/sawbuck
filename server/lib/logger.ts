import pino from 'pino';
import { env } from './env.js';

const logger = pino({
  level: env.logLevel,
  ...(!env.isProd && { transport: { target: 'pino-pretty', options: { colorize: true } } }),
});

export default logger;
