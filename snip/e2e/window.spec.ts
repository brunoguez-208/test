import { expect, test } from "@playwright/test";
import { open } from "./helpers";

// Botones de ventana: un solo juego, alineado arriba a la derecha, sin tapar
// las pestañas, y el ícono cambia entre maximizar y restaurar.
test("controles de ventana: un solo juego, alineados al maximizar y restaurar", async ({ page }) => {
  await open(page);
  const controls = page.getByTestId("window-controls");
  await expect(controls).toHaveCount(1);
  await expect(page.locator(".decorum-tb-btn")).toHaveCount(3);
  await expect(page.locator("#decorum-tb-maximize")).toHaveCount(1);

  const check = async () => {
    const vw = page.viewportSize()!.width;
    const boxes = await page.locator(".decorum-tb-btn").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
    // Pegados al borde derecho, arriba, del alto de la barra, uno al lado del otro.
    expect(Math.round(boxes[2].right)).toBe(vw);
    for (const [i, b] of boxes.entries()) {
      expect(b.top).toBe(0);
      expect(b.width).toBe(46);
      expect(b.height).toBe(40);
      if (i) expect(b.left).toBeCloseTo(boxes[i - 1].right, 0);
    }
    // Nada del contenido de la barra queda debajo de los botones.
    const content = await page.locator("#titlebar-content").evaluate((e) => e.getBoundingClientRect().right);
    expect(content).toBeLessThanOrEqual(boxes[0].left + 0.5);
  };

  await check();
  await page.getByTestId("win-maximize").click();
  await expect(controls).toHaveAttribute("data-maximized", "true");
  await expect(page.getByTestId("win-maximize")).toHaveAttribute("aria-label", "Restaurar");
  await expect(page.locator(".decorum-tb-btn")).toHaveCount(3);
  await check();
  await page.screenshot({ path: "e2e/screenshots/a2-maximizada.png", clip: { x: 900, y: 0, width: 380, height: 60 } });
  await page.getByTestId("win-maximize").click();
  await expect(controls).toHaveAttribute("data-maximized", "false");
  await expect(page.getByTestId("win-maximize")).toHaveAttribute("aria-label", "Maximizar");
  await check();

  // Recargar la página (lo que antes disparaba la inyección doble) no duplica nada.
  await page.reload();
  await expect(page.getByTestId("welcome").or(page.getByTestId("editor"))).toBeVisible();
  await expect(page.locator(".decorum-tb-btn")).toHaveCount(3);
});
