// Supabase Configuration
const SUPABASE_URL = "https://qlotppkpldbtokjlavbk.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsb3RwcGtwbGRidG9ramxhdmJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzNDAxOTgsImV4cCI6MjEwNzkxNjE5OH0.te_hXIg6SrYzy0NnHjUymjn_d1nYX80xpqZ5uVZVYW0";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const loginBtn = document.getElementById("login-btn");
const userProfile = document.getElementById("user-profile");
const userEmail = document.getElementById("user-email");

async function signInWithGoogle() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin
    }
  });
  if (error) console.error("Error signing in:", error.message);
}

async function signOut() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) console.error("Error signing out:", error.message);
  checkUser();
}

async function checkUser() {
  const { data: { user } } = await supabaseClient.auth.getUser();

  if (user) {
    if (loginBtn) loginBtn.style.display = "none";
    if (userProfile) userProfile.style.display = "flex";
    if (userEmail) userEmail.innerText = user.email;
  } else {
    if (loginBtn) loginBtn.style.display = "inline-block";
    if (userProfile) userProfile.style.display = "none";
    if (userEmail) userEmail.innerText = "";
  }
}

// Bind auth state observer
supabaseClient.auth.onAuthStateChange((_event, _session) => {
  checkUser();
});

// Initialize on page load
document.addEventListener("DOMContentLoaded", () => {
  checkUser();
});