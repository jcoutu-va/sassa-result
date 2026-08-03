import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDzLaeD_9Fxj7uGpxv6_6NH-_ItxHh9Fsg",
  authDomain: "sassa-odc.firebaseapp.com",
  projectId: "sassa-odc",
  storageBucket: "sassa-odc.firebasestorage.app",
  messagingSenderId: "232158332347",
  appId: "1:232158332347:web:9ca4032854e541a761f09e",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
