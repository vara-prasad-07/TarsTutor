import { WelcomeScreen } from "@excalidraw/excalidraw/index";
import React from "react";

export const AppWelcomeScreen = React.memo(() => (
  <WelcomeScreen>
    <WelcomeScreen.Center>
      <div className="tutor-welcome__brand">TarsTutor</div>
      <WelcomeScreen.Center.Heading>
        Make room for a new idea.
      </WelcomeScreen.Center.Heading>
      <p className="tutor-welcome__description">
        Sketch your thinking, open your notes, or add a question below. This is
        your space to work things out.
      </p>
      <WelcomeScreen.Center.Menu>
        <WelcomeScreen.Center.MenuItemLoadScene />
      </WelcomeScreen.Center.Menu>
    </WelcomeScreen.Center>
  </WelcomeScreen>
));
