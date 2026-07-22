import { Title } from "@solidjs/meta";
import { createAsync, useAction } from "@solidjs/router";
import { Show, createSignal } from "solid-js";
import { getUserQuery, loginAction } from "~/lib/queries";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  TextField,
  TextFieldInput,
  TextFieldLabel,
} from "@/components/ui/text-field";

export default function Login() {
  const user = createAsync(() => getUserQuery(), { deferStream: true });
  const login = useAction(loginAction);
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(false);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const fd = new FormData(e.target as HTMLFormElement);
    const result = await login(fd);
    setLoading(false);
    if (result?.error) setError(result.error);
  }

  return (
    <Show
      when={user()}
      fallback={
        <div class="flex min-h-screen items-center justify-center p-4">
          <Title>Login — Mad Cactus</Title>
          <Card class="w-full max-w-sm">
            <CardHeader>
              <CardTitle class="text-2xl">Mad Cactus Portal</CardTitle>
              <CardDescription>
                Sign in to access your dashboard
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} id="login-form" class="flex flex-col gap-4">
                <TextField>
                  <TextFieldLabel for="email">Email</TextFieldLabel>
                  <TextFieldInput
                    type="email"
                    id="email"
                    name="email"
                    required
                    placeholder="you@example.com"
                    autocomplete="email"
                  />
                </TextField>
                <TextField>
                  <TextFieldLabel for="password">Password</TextFieldLabel>
                  <TextFieldInput
                    type="password"
                    id="password"
                    name="password"
                    required
                    placeholder="••••••••"
                    autocomplete="current-password"
                  />
                </TextField>
                <Show when={error()}>
                  <p class="text-destructive text-sm">{error()}</p>
                </Show>
              </form>
            </CardContent>
            <CardFooter>
              <Button
                type="submit"
                form="login-form"
                class="w-full"
                disabled={loading()}
              >
                {loading() ? "Signing in…" : "Sign in"}
              </Button>
            </CardFooter>
          </Card>
        </div>
      }
    >
      <script>window.location.href = "/admin"</script>
    </Show>
  );
}
