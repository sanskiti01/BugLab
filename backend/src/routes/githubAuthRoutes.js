const express = require("express");
const passport = require("../config/githubPassport");

const router = express.Router();

router.get(
  "/github",
  passport.authenticate("github", {
    scope: ["user:email"],
  })
);

router.get(
  "/github/callback",
  passport.authenticate("github", {
    session: false,
    failureRedirect: "/",
  }),
  (req, res) => {
    res.json({
      message: "GitHub authentication successful",
      user: {
        id: req.user.id,
        username: req.user.username,
        email: req.user.email,
        githubId: req.user.githubId,
      },
    });
  }
);

module.exports = router;