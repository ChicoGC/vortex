/* ==========================================================================
   vortex — auth views (login / signup)
   Real Supabase email+password auth. Wired up in app.js (submit handlers,
   boot-time session check, route guarding).
   ========================================================================== */

VIEWS.login = function () {
  const form =
    '<form class="panel panel--raised auth" id="authLoginForm" novalidate>' +
      '<div class="auth__head">' +
        '<span class="auth__mark"><img src="assets/logo-64.png" width="30" height="30" alt=""></span>' +
        '<h2 class="t-title-m">Sign in to vortex</h2>' +
        '<p class="t-body-s c-tertiary">See what your friends are listening to, in real time.</p>' +
      '</div>' +
      '<div class="auth__note auth__note--error" id="authError" hidden>' + icon('close', 16) +
        '<p class="t-body-s c-secondary" id="authErrorText"></p>' +
      '</div>' +
      '<div class="auth__field">' +
        '<label class="t-label-m c-secondary" for="authEmail">Email</label>' +
        '<span class="field">' + icon('mail', 17) +
          '<input id="authEmail" type="email" placeholder="you@example.com" autocomplete="email" required></span>' +
      '</div>' +
      '<div class="auth__field">' +
        '<label class="t-label-m c-secondary" for="authPass">Password</label>' +
        '<span class="field">' + icon('lock', 17) +
          '<input id="authPass" type="password" placeholder="••••••••" autocomplete="current-password" required>' +
          '<button type="button" class="iconbtn" data-pass-toggle aria-label="Show password">' + icon('eye', 17) + '</button>' +
        '</span>' +
      '</div>' +
      '<button type="submit" class="btn btn--primary" id="authLoginSubmit" style="width:100%;padding:0 16px">Log in</button>' +
      '<p class="t-body-s c-tertiary" style="text-align:center">No account yet? ' +
        '<a class="btn btn--ghost btn--sm" href="#/signup" style="padding:0 4px;display:inline-flex">Create one</a></p>' +
    '</form>';

  return '<div class="view">' +
    pageHead('Welcome back', 'Sign in') +
    '<div class="auth-wrap scroll">' + form + '</div>' +
  '</div>';
};

VIEWS.signup = function () {
  const form =
    '<form class="panel panel--raised auth" id="authSignupForm" novalidate>' +
      '<div class="auth__head">' +
        '<span class="auth__mark"><img src="assets/logo-64.png" width="30" height="30" alt=""></span>' +
        '<h2 class="t-title-m">Create your account</h2>' +
        '<p class="t-body-s c-tertiary">Free while vortex is in beta.</p>' +
      '</div>' +
      '<div class="auth__note auth__note--error" id="authError" hidden>' + icon('close', 16) +
        '<p class="t-body-s c-secondary" id="authErrorText"></p>' +
      '</div>' +
      '<div class="auth__field">' +
        '<label class="t-label-m c-secondary" for="authName">Name</label>' +
        '<span class="field">' + icon('user', 17) +
          '<input id="authName" type="text" placeholder="Your name" autocomplete="name" required></span>' +
      '</div>' +
      '<div class="auth__field">' +
        '<label class="t-label-m c-secondary" for="authUsername">Username</label>' +
        '<span class="field">' + icon('user', 17) +
          '<input id="authUsername" type="text" placeholder="handle" autocomplete="username" pattern="[a-zA-Z0-9_]{3,20}" required></span>' +
      '</div>' +
      '<div class="auth__field">' +
        '<label class="t-label-m c-secondary" for="authEmail">Email</label>' +
        '<span class="field">' + icon('mail', 17) +
          '<input id="authEmail" type="email" placeholder="you@example.com" autocomplete="email" required></span>' +
      '</div>' +
      '<div class="auth__field">' +
        '<label class="t-label-m c-secondary" for="authPass">Password</label>' +
        '<span class="field">' + icon('lock', 17) +
          '<input id="authPass" type="password" placeholder="At least 6 characters" autocomplete="new-password" minlength="6" required>' +
          '<button type="button" class="iconbtn" data-pass-toggle aria-label="Show password">' + icon('eye', 17) + '</button>' +
        '</span>' +
      '</div>' +
      '<button type="submit" class="btn btn--primary" id="authSignupSubmit" style="width:100%;padding:0 16px">Create account</button>' +
      '<p class="t-body-s c-tertiary" style="text-align:center">Already have an account? ' +
        '<a class="btn btn--ghost btn--sm" href="#/login" style="padding:0 4px;display:inline-flex">Log in</a></p>' +
    '</form>';

  return '<div class="view">' +
    pageHead('Join vortex', 'Create account') +
    '<div class="auth-wrap scroll">' + form + '</div>' +
  '</div>';
};
