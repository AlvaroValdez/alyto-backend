import { ipKeyGenerator } from 'express-rate-limit';
console.log(ipKeyGenerator('192.168.1.1', 64));
console.log(ipKeyGenerator('2001:0db8:85a3:0000:0000:8a2e:0370:7334', 64));
