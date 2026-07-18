const express = require('express');
const session = require('express-session');
const path = require('path');
require('dotenv').config();

const store = require('./lib/store');
const auth = require('./lib/auth');
const { connectDB } = require('./lib/database');

const app = express();

// 连接数据库
connectDB().catch(console.error);

// 初始化邮件服务
const nodemailer = require('nodemailer');
const mailTransporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: process.env.MAIL_PORT,
  secure: process.env.MAIL_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
});

// 将邮件服务传递给 auth 模块
auth.setMailTransporter(mailTransporter);

// 测试邮件连接
mailTransporter.verify(function(error, success) {
  if (error) {
    console.log('邮件服务连接失败:', error);
  } else {
    console.log('邮件服务已就绪:', success);
  }
});

const PORT = process.env.PORT || 3002;

// 信任反向代理（Nginx 等）的 X-Forwarded-* 头：
// 公网部署时代理做 SSL 终止，Node 侧连接为 HTTP，若不开启则
// req.secure 恒为 false，导致 secure cookie（FORCE_HTTPS=1）不会被下发，
// session 丢失，进而引发登录 CSRF 校验失败；同时 req.ip 也会取到代理 IP。
app.set('trust proxy', 1);

// 是否启用 HTTPS 强制重定向（公网部署设 FORCE_HTTPS=1）
const FORCE_HTTPS = process.env.FORCE_HTTPS === '1';

// 视图与静态资源
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
// JSON body 提高到 10mb，截图排程需上传 base64 图片
app.use(express.json({ limit: '10mb' }));

// HTTPS 强制重定向：公网部署时，所有 HTTP 请求 301 跳转到 HTTPS
if (FORCE_HTTPS) {
  app.use((req, res, next) => {
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    if (proto === 'http') {
      return res.redirect(301, 'https://' + req.headers.host + req.url);
    }
    next();
  });
}

// 阻止 data.json 被直接访问（防止通过 URL 下载敏感数据）
app.use('/data.json', (req, res) => {
  res.status(403).send('禁止访问');
});

// 启动时顺延未完成任务
store.carryOver();

// 启动时迁移：把没有 userId 的 todos/archives/settings 归到第一个用户名下
// 保证升级前的数据升级后仍可见
store.migrateOwnership().catch(err => console.error('数据迁移失败:', err));

// 异步初始化：必须 await session secret 后才能挂 session 中间件与路由（secret 是 async 读 data.json）
async function start() {
  // session：使用持久化 secret（存于 data.json），避免重启后登录态全部失效
  const SECRET = process.env.SESSION_SECRET || await store.getSessionSecret();
  app.use(session({
    secret: SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 天
      httpOnly: true,                  // 禁止 JS 读取 cookie，防 XSS 窃取
      secure: FORCE_HTTPS,             // 仅 HTTPS 下发送（生产环境）
      sameSite: 'lax'                  // 防 CSRF
    }
  }));

  // 让视图能拿到当前路径用于高亮导航，并注入 CSRF token（依赖 session，须在 session 之后）
  app.use((req, res, next) => {
    res.locals.path = req.path;
    res.locals.csrfToken = auth.ensureCsrfToken(req);
    next();
  });

  // CSRF 校验：所有 POST 请求必须携带正确的 _csrf token
  app.use((req, res, next) => {
    if (req.method === 'POST' && !auth.verifyCsrf(req)) {
      return res.status(403).send('CSRF 校验失败，请刷新页面后重试');
    }
    next();
  });

  // 路由
  app.use('/', require('./routes/auth'));
  app.use('/register', require('./routes/register'));
  app.use('/password', require('./routes/password'));
  app.use('/', auth.requireAuth, require('./routes/todos'));
  app.use('/archive', auth.requireAuth, require('./routes/archive'));
  app.use('/search', auth.requireAuth, require('./routes/search'));
  app.use('/stats', auth.requireAuth, require('./routes/stats'));
  app.use('/settings', auth.requireAuth, require('./routes/settings'));

  // 404
  app.use((req, res) => {
    res.status(404).send('页面不存在');
  });

  app.listen(PORT, async () => {
    console.log(`日清 todo 已启动: http://localhost:${PORT}`);
    if (await auth.needsInit()) {
      console.log('首次使用，请在打开的页面设置登录密码。');
    }
  });
}

start().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
