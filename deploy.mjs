import { Client } from 'ssh2';

const HOST = process.env.DEPLOY_HOST;
const PASS = process.env.DEPLOY_PASS;

if (!HOST || !PASS) {
  console.error('请先设置环境变量 DEPLOY_HOST 和 DEPLOY_PASS');
  process.exit(1);
}

function execCmd(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      let closed = false;
      stream.on('close', (code) => {
        closed = true;
        if (code !== 0 && code != null) {
          reject(new Error(`命令退出码 ${code}\n${stderr}\n${stdout}`));
        } else {
          resolve(stdout);
        }
      });
      stream.on('data', (data) => {
        stdout += data.toString();
        process.stdout.write(data);
      });
      stream.stderr.on('data', (data) => {
        stderr += data.toString();
        process.stderr.write(data);
      });
      // 防止长时间没输出被断开
      stream.on('exit', () => {
        setTimeout(() => {
          if (!closed) reject(new Error('命令执行超时'));
        }, 60000);
      });
    });
  });
}

function uploadFile(conn, local, remote) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.fastPut(local, remote, (err2) => {
        if (err2) return reject(err2);
        resolve();
      });
    });
  });
}

const conn = new Client();

conn.on('ready', async () => {
  try {
    console.log('SSH 连接成功');

    console.log('1. 更新系统并安装 curl...');
    await execCmd(conn, `
      export DEBIAN_FRONTEND=noninteractive
      apt-get update -y
      apt-get install -y curl
    `);

    console.log('2. 安装 Node.js 20...');
    await execCmd(conn, `
      if ! command -v node > /dev/null 2>&1 || [ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" != "20" ]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
      fi
      node -v
      npm -v
    `);

    console.log('3. 准备目录...');
    await execCmd(conn, 'mkdir -p /opt/Liar-Travern');
    await execCmd(conn, 'mkdir -p /var/lib/liar-tavern && chmod 755 /var/lib/liar-tavern');

    console.log('4. 上传项目压缩包...');
    await uploadFile(conn, 'D:/liar-travern.tar.gz', '/tmp/liar-travern.tar.gz');

    console.log('5. 解压项目...');
    await execCmd(conn, `
      rm -rf /opt/Liar-Travern/*
      tar -xzf /tmp/liar-travern.tar.gz -C /opt/Liar-Travern
    `);

    console.log('6. 安装项目依赖...');
    await execCmd(conn, 'cd /opt/Liar-Travern && npm install');

    console.log('7. 安装并启动 pm2...');
    await execCmd(conn, `
      npm install -g pm2
      cd /opt/Liar-Travern
      pm2 delete cheat-bar 2> /dev/null || true
      NODE_ENV=production USERS_FILE_PATH=/var/lib/liar-tavern/users.json pm2 start server/index.js --name cheat-bar
      pm2 save
    `);

    console.log('\n部署完成！');
    console.log('请访问 http://' + HOST + ':3000');
    console.log('如果打不开，请检查阿里云防火墙是否放行了 3000 端口。');
  } catch (e) {
    console.error('\n部署出错:', e.message);
  } finally {
    conn.end();
  }
});

conn.on('error', (err) => {
  console.error('SSH 错误:', err.message);
});

conn.connect({
  host: HOST,
  port: 22,
  username: 'root',
  password: PASS,
  readyTimeout: 60000,
  keepaliveInterval: 30000,
  keepaliveCountMax: 3
});
