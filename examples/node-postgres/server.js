// The app the node-app recipe runs (npm run dev). It listens where the recipe says (HOST,
// PORT) and gets the database's URL from the postgres recipe; a real app would connect to
// it with a client such as `pg`, installed in the running app (npm install), never in the
// image.
const http = require('node:http');
const os = require('node:os');

const database = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;

http
  .createServer((req, res) => {
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(
      [
        `Hello from ${os.userInfo().username}, the user named after the project.`,
        database ? `Database: ${database.hostname}:${database.port}${database.pathname}` : 'No database wired.',
        '',
      ].join('\n'),
    );
  })
  .listen(Number(process.env.PORT), process.env.HOST);
