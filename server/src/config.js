export const config = {
  port: Number(process.env.PORT ?? 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5173",
  jwtSecret: process.env.JWT_SECRET ?? "dev_only_change_me",
  dbPath: process.env.DB_PATH ?? "./data/app.sqlite",
};



