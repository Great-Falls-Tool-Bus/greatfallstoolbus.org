"""Hermetic extraction of the exact deployment app-root archive for tests."""

_TAR_TOOLCHAIN_TYPE = Label("@aspect_bazel_lib//lib:tar_toolchain_type")


def _extract_deployment_app_root_impl(ctx):
    app_root = ctx.actions.declare_directory("{}/app".format(ctx.label.name))
    tarinfo = ctx.toolchains[_TAR_TOOLCHAIN_TYPE].tarinfo

    args = ctx.actions.args()
    args.add("--extract")
    args.add("--file", ctx.file.src)
    args.add("--directory", app_root.dirname)
    args.add("--no-same-owner")
    args.add("--no-same-permissions")

    ctx.actions.run(
        arguments = [args],
        env = tarinfo.default_env,
        executable = tarinfo.binary,
        inputs = [ctx.file.src],
        mnemonic = "ExtractDeploymentAppRoot",
        outputs = [app_root],
        progress_message = "Extracting exact deployment app root %{label}",
        toolchain = _TAR_TOOLCHAIN_TYPE,
    )

    return [DefaultInfo(files = depset([app_root]))]


extract_deployment_app_root = rule(
    implementation = _extract_deployment_app_root_impl,
    attrs = {
        "src": attr.label(
            allow_single_file = [".tar"],
            mandatory = True,
        ),
    },
    toolchains = [_TAR_TOOLCHAIN_TYPE],
)
