import "reflect-metadata";
import { Permission } from "../permission.enum";
import { PermissionsDto } from "../permissions.dto";

describe("PermissionsDto", () => {
  it("declares one required Swagger property per Permission typed as Scope", () => {
    const declared = Reflect.getMetadata(
      "swagger/apiModelPropertiesArray",
      PermissionsDto.prototype,
    ) as string[] | undefined;

    expect(declared).toBeDefined();
    expect([...(declared ?? [])].sort()).toEqual(
      Object.values(Permission)
        .map((permission) => `:${permission}`)
        .sort(),
    );

    for (const permission of Object.values(Permission)) {
      const meta = Reflect.getMetadata(
        "swagger/apiModelProperties",
        PermissionsDto.prototype,
        permission,
      ) as { enumName?: string; required?: boolean; enum?: readonly string[] };
      expect(meta.enumName).toBe("Scope");
      expect(meta.required).not.toBe(false);
      expect(meta.enum).toEqual(["all", "own", "department", "allocated", "lessonTeacher", "none"]);
    }
  });
});
