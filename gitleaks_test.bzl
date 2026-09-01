"""Hermetic current-source Gitleaks test rule."""

def _external_runfiles_path(file):
    """Return an external executable's path beneath TEST_SRCDIR."""
    if not file.short_path.startswith("../"):
        fail("gitleaks executable must come from an external toolchain repository")
    return file.short_path[3:]

def _gitleaks_test_impl(ctx):
    launcher = ctx.actions.declare_file(ctx.label.name + ".sh")
    scanner_path = _external_runfiles_path(ctx.executable._gitleaks)

    ctx.actions.write(
        content = "\n".join([
            "#!/bin/sh",
            "set -eu",
            "readonly source_root=\"${TEST_SRCDIR:?}/${TEST_WORKSPACE:?}\"",
            "readonly scanner=\"${TEST_SRCDIR:?}/" + scanner_path + "\"",
            "exec \"${scanner}\" dir \"${source_root}\" \\",
            "  --config \"${source_root}/.gitleaks.toml\" \\",
            "  --exit-code 1 --no-banner --no-color --redact=100",
            "",
        ]),
        is_executable = True,
        output = launcher,
    )

    runfiles = ctx.runfiles(
        files = ctx.files.srcs + [
            ctx.file.config,
            ctx.executable._gitleaks,
        ],
    )
    runfiles = runfiles.merge(ctx.attr._gitleaks[DefaultInfo].default_runfiles)

    return [DefaultInfo(
        executable = launcher,
        runfiles = runfiles,
    )]

gitleaks_test = rule(
    implementation = _gitleaks_test_impl,
    attrs = {
        "srcs": attr.label_list(
            allow_files = True,
            mandatory = True,
        ),
        "config": attr.label(
            allow_single_file = True,
            mandatory = True,
        ),
        "_gitleaks": attr.label(
            cfg = "exec",
            default = Label("@multitool//tools/gitleaks"),
            executable = True,
        ),
    },
    test = True,
)
