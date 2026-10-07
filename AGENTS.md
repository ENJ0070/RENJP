<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep public-site cosmic-web decoration in a single root-level canvas, excluding admin and seller panels, so visual motion does not duplicate across routes or intercept clicks.
- Archive known product CDN images in content-addressed public storage before saving product media; preserve source URLs on failure so unavailable providers cannot erase photos.
- Use StableImage for product and QC displays so failures advance through gallery alternatives without blank or broken-image icons.
