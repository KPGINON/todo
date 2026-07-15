const express = require('express');
const session = require('express-session');
const path = require('path');

const store = require('./lib/store');
const auth = require('./lib/auth');
const { connectDB } = require('./lib/database');

const app = express();

// 连接数据库
connectDB().catch(console.error);

const app = express();
const PORT = process.env.PORT || 3000;

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

// session：使用持久化 secret（存于 data.json），避免重启后登录态全部失效
const SECRET = process.env.SESSION_SECRET || store.getSessionSecret();
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

// 让视图能拿到当前路径用于高亮导航，并注入 CSRF token
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

// 阻止 data.json 被直接访问（防止通过 URL 下载敏感数据）
app.use('/data.json', (req, res) => {
  res.status(403).send('禁止访问');
});

// 启动时顺延未完成任务
store.carryOver();

// 路由
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/auth'));
app.use('/login', require('./routes/todos'));
app.use('/register', require('./routes/todos'));
app.use('/', auth.requireAuth, require('./routes/todos'));
app.use('/archive', auth.requireAuth, require('./routes/archive'));
app.use('/search', auth.requireAuth, require('./routes/search'));
app.use('/stats', auth.requireAuth, require('./routes/stats'));
app.use('/settings', auth.requireAuth, require('./routes/settings'));

// 404
app.use((req, res) => {
  res.status(404).send('页面不存在');
});

app.listen(PORT, () => {
  console.log(`日清 todo 已启动: http://localhost:${PORT}`);
  if (auth.needsInit()) {
    console.log('首次使用，请在打开的页面设置登录密码。');
  }
});
