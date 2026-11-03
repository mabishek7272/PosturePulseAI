import { Redirect, type Href } from "expo-router";

/** The animated splash is always the first screen; it decides /home vs /login. */
export default function Index() {
  return <Redirect href={"/splash" as Href} />;
}
