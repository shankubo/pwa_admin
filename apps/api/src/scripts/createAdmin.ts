import { db } from "../db/index.js";
import { UserModel } from "../db/models/user.js";
import { AuthService } from "../modules/auth/auth.service.js";

async function main() {
  const username = process.argv[2];
  const password = process.argv[3];

  if (!username || !password) {
    console.error("Usage: npm run create-admin --workspace=apps/api -- <username> <password>");
    process.exit(1);
  }

  if (UserModel.findByUsername(username)) {
    console.error(`User "${username}" already exists.`);
    process.exit(1);
  }

  const hash = await AuthService.hashPassword(password);
  const user = UserModel.create(username, hash);
  console.log(`Admin user created: ${user.username} (id=${user.id})`);
  console.log("Log in, then enroll 2FA via POST /api/auth/2fa/enroll before relying on this account.");
  db.close();
}

main();
