const passport = require("passport");
const GitHubStrategy = require("passport-github2").Strategy;

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

passport.use(
  new GitHubStrategy(
    {
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: process.env.GITHUB_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const githubId = profile.id;
        const username = profile.username || profile.displayName || `github_${githubId}`;
        const avatarUrl = profile.photos?.[0]?.value || null;

        let user = await prisma.user.findUnique({
          where: { githubId },
        });

        if (!user) {
          user = await prisma.user.create({
            data: {
              username,
              email: profile.emails?.[0]?.value || null,
              githubId,
              avatarUrl,
            },
          });
        }

        await prisma.gitHubConnection.upsert({
          where: {
            userId: user.id,
          },
          update: {
            githubId,
            username,
            accessToken,
          },
          create: {
            userId: user.id,
            githubId,
            username,
            accessToken,
          },
        });

        return done(null, user);
      } catch (error) {
        console.error("GitHub OAuth error:", error);
        return done(error, null);
      }
    }
  )
);

module.exports = passport;