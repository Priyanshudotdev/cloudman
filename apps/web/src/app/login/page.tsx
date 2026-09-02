"use client";

import { Cloud } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";

export default function LoginPage() {
	const [showSignIn, setShowSignIn] = useState(false);

	return (
		<div className="flex min-h-full flex-col items-center justify-center px-6 py-12">
			<Link href="/" className="mb-8 flex items-center gap-2 font-semibold text-lg">
				<span className="flex size-8 items-center justify-center rounded-md bg-brand text-brand-foreground">
					<Cloud className="size-4.5" />
				</span>
				CloudMan
			</Link>
			{showSignIn ? (
				<SignInForm onSwitchToSignUp={() => setShowSignIn(false)} />
			) : (
				<SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} />
			)}
		</div>
	);
}
