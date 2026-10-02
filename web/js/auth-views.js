/* ==========================================================================
   vortex — auth views (login / signup)
   Real Supabase email+password auth. Wired up in app.js (submit handlers,
   boot-time session check, route guarding).
   ========================================================================== */

/* Google's "G" keeps its brand colours, so it's inline SVG instead of a themed icon. */
const GOOGLE_G =
  '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9z"/>' +
    '<path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-3l-3.9-3c-1.1.7-2.4 1.1-4 1.1-3.1 0-5.7-2.1-6.7-4.9H1.3v3.1A12 12 0 0 0 12 24z"/>' +
    '<path fill="#FBBC05" d="M5.3 14.2a7.2 7.2 0 0 1 0-4.6V6.5H1.3a12 12 0 0 0 0 11z"/>' +
    '<path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.5l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/>' +
  '</svg>';

/* A real checkbox (keyboard, screen readers, form state) drawn as the app's .check square. */
function consentBox(id, lead) {
  return '<label class="consent t-body-s c-secondary">' +
    '<input type="checkbox" class="consent__input" id="' + id + '">' +
    '<span class="check" aria-hidden="true">' + icon('check', 12) + '</span>' +
    '<span>' + t(lead, { link: '<a class="consent__link" href="' + PRIVACY_URL + '" target="_blank" rel="noopener">' + t('Privacy Policy') + '</a>' }) + '</span>' +
  '</label>';
}

function legalFooter() {
  return '<p class="auth__legal t-caption"><a href="' + PRIVACY_URL + '" target="_blank" rel="noopener">' + t('Privacy Policy') + '</a></p>';
}

function googleButton() {
  return '<button type="button" class="btn btn--secondary auth__google" data-action="google-signin" style="width:100%">' +
    GOOGLE_G + '<span>' + t('Continue with Google') + '</span></button>' +
    '<div class="auth__sep t-caption" role="separator"><span>' + t('or use your email') + '</span></div>';
}

VIEWS.login = function () {
  const form =
    '<form class="panel panel--raised auth" id="authLoginForm" novalidate>' +
      '<div class="auth__head">' +
        '<span class="auth__mark"><img src="assets/logo-64.png" width="30" height="30" alt=""></span>' +
        '<h2 class="t-title-m">' + t('Sign in to vortex') + '</h2>' +
        '<p class="t-body-s c-tertiary">' + (pendingDeepLink ? t('Log in to open the link you were sent.') : t('See what your friends are listening to, in real time.')) + '</p>' +
      '</div>' +
      '<div class="auth__note auth__note--error" id="authError" hidden>' + icon('close', 16) +
        '<p class="t-body-s c-secondary" id="authErrorText"></p>' +
      '</div>' +
      googleButton() +
      '<div class="auth__field">' +
        '<label class="t-label-m c-secondary" for="authEmail">' + t('Email') + '</label>' +
        '<span class="field">' + icon('mail', 17) +
          '<input id="authEmail" type="email" placeholder="' + t('you@example.com') + '" autocomplete="email" required></span>' +
      '</div>' +
      '<div class="auth__field">' +
        '<span class="field-label-row"><label class="t-label-m c-secondary" for="authPass">' + t('Password') + '</label>' +
          '<a class="t-label-s auth__forgot" href="#/forgot" data-forgot-link>' + t('Forgot password?') + '</a></span>' +
        '<span class="field">' + icon('lock', 17) +
          '<input id="authPass" type="password" placeholder="••••••••" autocomplete="current-password" required>' +
          '<button type="button" class="iconbtn" data-pass-toggle aria-label="' + t('Show password') + '">' + icon('eye', 17) + '</button>' +
        '</span>' +
      '</div>' +
      '<button type="submit" class="btn btn--primary" id="authLoginSubmit" style="width:100%;padding:0 16px">' + t('Log in') + '</button>' +
      '<p class="t-body-s c-tertiary" style="text-align:center">' + t('No account yet?') + ' ' +
        '<a class="btn btn--ghost btn--sm" href="#/signup" style="padding:0 4px;display:inline-flex">' + t('Create one') + '</a></p>' +
    '</form>';

  return '<div class="view">' +
    pageHead(t('Welcome back'), t('Sign in')) +
    '<div class="auth-wrap scroll">' + form + legalFooter() + '</div>' +
  '</div>';
};

VIEWS.signup = function () {
  const form =
    '<form class="panel panel--raised auth" id="authSignupForm" novalidate>' +
      '<div class="auth__head">' +
        '<span class="auth__mark"><img src="assets/logo-64.png" width="30" height="30" alt=""></span>' +
        '<h2 class="t-title-m">' + t('Create your account') + '</h2>' +
        '<p class="t-body-s c-tertiary">' + (pendingDeepLink ? t('Sign up to open the link you were sent.') : t('Free while vortex is in beta.')) + '</p>' +
      '</div>' +
      '<div class="auth__note auth__note--error" id="authError" hidden>' + icon('close', 16) +
        '<p class="t-body-s c-secondary" id="authErrorText"></p>' +
      '</div>' +
      googleButton() +
      '<div class="auth__field">' +
        '<label class="t-label-m c-secondary" for="authName">' + t('Name') + '</label>' +
        '<span class="field">' + icon('user', 17) +
          '<input id="authName" type="text" placeholder="' + t('Your name') + '" autocomplete="name" maxlength="50" required></span>' +
      '</div>' +
      '<div class="auth__field">' +
        '<label class="t-label-m c-secondary" for="authUsername">' + t('Username') + '</label>' +
        '<span class="field">' + icon('user', 17) +
          '<input id="authUsername" type="text" placeholder="' + t('handle') + '" autocomplete="username" pattern="[a-zA-Z0-9_]{3,20}" required></span>' +
      '</div>' +
      '<div class="auth__field">' +
        '<label class="t-label-m c-secondary" for="authEmail">' + t('Email') + '</label>' +
        '<span class="field">' + icon('mail', 17) +
          '<input id="authEmail" type="email" placeholder="' + t('you@example.com') + '" autocomplete="email" required></span>' +
      '</div>' +
      '<div class="auth__field">' +
        '<label class="t-label-m c-secondary" for="authPass">' + t('Password') + '</label>' +
        '<span class="field">' + icon('lock', 17) +
          '<input id="authPass" type="password" placeholder="' + t('At least 6 characters') + '" autocomplete="new-password" minlength="6" required>' +
          '<button type="button" class="iconbtn" data-pass-toggle aria-label="' + t('Show password') + '">' + icon('eye', 17) + '</button>' +
        '</span>' +
      '</div>' +
      consentBox('authConsent', 'I’ve read and agree to the vortex {link}.') +
      '<button type="submit" class="btn btn--primary" id="authSignupSubmit" style="width:100%;padding:0 16px">' + t('Create account') + '</button>' +
      '<p class="t-body-s c-tertiary" style="text-align:center">' + t('Already have an account?') + ' ' +
        '<a class="btn btn--ghost btn--sm" href="#/login" style="padding:0 4px;display:inline-flex">' + t('Log in') + '</a></p>' +
    '</form>';

  return '<div class="view">' +
    pageHead(t('Join vortex'), t('Create account')) +
    '<div class="auth-wrap scroll">' + form + legalFooter() + '</div>' +
  '</div>';
};

function authHead(title, sub) {
  return '<div class="auth__head">' +
    '<span class="auth__mark"><img src="assets/logo-64.png" width="30" height="30" alt=""></span>' +
    '<h2 class="t-title-m">' + title + '</h2>' +
    '<p class="t-body-s c-tertiary">' + sub + '</p>' +
  '</div>';
}

function authErrorBox() {
  return '<div class="auth__note auth__note--error" id="authError" hidden>' + icon('close', 16) +
    '<p class="t-body-s c-secondary" id="authErrorText"></p></div>';
}

/* forgotState: { sentTo } once the link went out, so a re-render keeps the confirmation. */
VIEWS.forgot = function () {
  const sent = forgotState.sentTo;
  const body = sent
    ? '<div class="panel panel--raised auth">' +
        authHead(t('Check your inbox'), t('If {email} has a vortex account, a link to choose a new password is on its way.', { email: '<b class="c-primary">' + esc(sent) + '</b>' })) +
        '<ul class="auth__steps t-body-s c-secondary">' +
          '<li>' + icon('mail', 16) + '<span>' + t('It can take a minute. Check spam if it doesn’t show up.') + '</span></li>' +
          '<li>' + icon('lock', 16) + '<span>' + t('The link works once, on any device.') + '</span></li>' +
        '</ul>' +
        '<button type="button" class="btn btn--secondary" data-action="forgot-resend" id="forgotResend" style="width:100%">' + t('Send it again') + '</button>' +
        '<a class="btn btn--ghost btn--sm" href="#/login" style="align-self:center">' + t('Back to log in') + '</a>' +
      '</div>'
    : '<form class="panel panel--raised auth" id="authForgotForm" novalidate>' +
        authHead(t('Reset your password'), t('Enter the email you signed up with and we’ll send you a link to choose a new one.')) +
        authErrorBox() +
        '<div class="auth__field">' +
          '<label class="t-label-m c-secondary" for="authEmail">' + t('Email') + '</label>' +
          '<span class="field">' + icon('mail', 17) +
            '<input id="authEmail" type="email" placeholder="' + t('you@example.com') + '" autocomplete="email" required value="' + esc(forgotState.draft || '') + '"></span>' +
        '</div>' +
        '<button type="submit" class="btn btn--primary" id="authForgotSubmit" style="width:100%;padding:0 16px">' + t('Send reset link') + '</button>' +
        '<a class="btn btn--ghost btn--sm" href="#/login" style="align-self:center">' + t('Back to log in') + '</a>' +
      '</form>';
  return '<div class="view">' + pageHead(t('Account'), t('Forgot password')) + '<div class="auth-wrap scroll">' + body + '</div></div>';
};

/* Shown until the account is set up. A first Google sign-in confirms the handle generated from the
   email and accepts the policy; an account that accepted an older policy (or none) only re-accepts. */
VIEWS.welcome = function () {
  const me = DATA.me;
  const handle = myHandle();
  const first = esc(me.name.split(/\s+/)[0] || t('there'));
  const head = app.needsUsername
    ? authHead(t('Choose your username'), t('Welcome, {name}. This is how friends find you, and it’s the link to your profile.', { name: '<b class="c-primary">' + first + '</b>' }))
    : authHead(t('Review the privacy policy'), t('Hi {name}. The policy explains what vortex keeps and who can see it. Accept it to keep using vortex.', { name: '<b class="c-primary">' + first + '</b>' }));
  const nameFields = !app.needsUsername ? '' :
      '<div class="auth__field">' +
        '<label class="t-label-m c-secondary" for="welcomeName">' + t('Display name') + '</label>' +
        '<span class="field">' + icon('user', 17) +
          '<input id="welcomeName" type="text" maxlength="' + NAME_MAX + '" autocomplete="name" required value="' + esc(me.name) + '"></span>' +
      '</div>' +
      '<div class="auth__field">' +
        '<label class="t-label-m c-secondary" for="welcomeUsername">' + t('Username') + '</label>' +
        '<span class="field"><span class="field__at" aria-hidden="true">@</span>' +
          '<input id="welcomeUsername" type="text" maxlength="20" autocomplete="username" spellcheck="false" required value="' + esc(handle) + '" aria-describedby="welcomeUsernameHint"></span>' +
        '<p class="t-caption field-hint" id="welcomeUsernameHint">' + t('We picked this from your email. Your profile link is {link}', { link: esc(location.host) + '/#/u/' + esc(handle) }) + '</p>' +
      '</div>';
  const form =
    '<form class="panel panel--raised auth" id="authWelcomeForm" novalidate>' +
      head +
      authErrorBox() +
      nameFields +
      (app.needsConsent ? consentBox('welcomeConsent', 'I’ve read and agree to the vortex {link}.') : '') +
      '<button type="submit" class="btn btn--primary" id="authWelcomeSubmit" style="width:100%;padding:0 16px">' + t('Continue') + '</button>' +
      '<button type="button" class="btn btn--ghost btn--sm" data-action="logout" style="align-self:center">' + (app.needsUsername ? t('Use a different account') : t('Log out')) + '</button>' +
    '</form>';
  return '<div class="view">' +
    pageHead(t('Almost there'), app.needsUsername ? t('Choose username') : t('Privacy policy')) +
    '<div class="auth-wrap scroll">' + form + '</div></div>';
};

VIEWS.reset = function () {
  const form =
    '<form class="panel panel--raised auth" id="authResetForm" novalidate>' +
      authHead(t('Choose a new password'), t('For {account}. You’ll stay logged in on this device.', { account: '<b class="c-primary">' + esc((app.session && app.session.user.email) || t('your account')) + '</b>' })) +
      authErrorBox() +
      '<div class="auth__field">' +
        '<label class="t-label-m c-secondary" for="authNewPass">' + t('New password') + '</label>' +
        '<span class="field">' + icon('lock', 17) +
          '<input id="authNewPass" type="password" placeholder="' + t('At least 6 characters') + '" autocomplete="new-password" minlength="6" required>' +
          '<button type="button" class="iconbtn" data-pass-toggle aria-label="' + t('Show password') + '">' + icon('eye', 17) + '</button>' +
        '</span>' +
      '</div>' +
      '<div class="auth__field">' +
        '<label class="t-label-m c-secondary" for="authNewPass2">' + t('Type it again') + '</label>' +
        '<span class="field">' + icon('lock', 17) +
          '<input id="authNewPass2" type="password" autocomplete="new-password" minlength="6" required></span>' +
      '</div>' +
      '<button type="submit" class="btn btn--primary" id="authResetSubmit" style="width:100%;padding:0 16px">' + t('Save new password') + '</button>' +
      '<button type="button" class="btn btn--ghost btn--sm" data-action="reset-skip" style="align-self:center">' + (resetReturn === '#/settings' ? t('Cancel') : t('Not now')) + '</button>' +
    '</form>';
  return '<div class="view">' + pageHead(t('Account'), t('New password')) + '<div class="auth-wrap scroll">' + form + '</div></div>';
};
